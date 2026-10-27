package dev.neru.localai

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.io.MemoryUsageSetting
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.text.PDFTextStripper
import org.apache.poi.hwpf.extractor.WordExtractor
import org.apache.poi.hssf.extractor.EventBasedExcelExtractor
import org.apache.poi.poifs.filesystem.POIFSFileSystem
import org.xmlpull.v1.XmlPullParser
import org.xmlpull.v1.XmlPullParserFactory
import java.io.File
import java.io.FilterInputStream
import java.io.InputStream
import java.io.StringWriter
import java.net.URI
import java.util.concurrent.TimeUnit
import java.util.zip.ZipFile

/** Text extraction runs off the JS/UI threads and never loads Office media into JS. */
internal object DocumentReader {
  private const val LIMIT = 200_000
  private const val XML_LIMIT = 16 * 1024 * 1024
  private const val MAX_FILE = 50L * 1024 * 1024
  private class Full : RuntimeException()
  private class Text {
    val value = StringBuilder()
    var truncated = false
    fun add(s: String) {
      val room = LIMIT - value.length
      value.append(s.take(room.coerceAtLeast(0)))
      if (s.length > room) { truncated = true; throw Full() }
    }
  }

  fun read(context: Context, uri: String, name: String, mime: String): Map<String, Any> {
    val file = File(URI(uri)).canonicalFile
    require(file.path.startsWith(context.filesDir.canonicalPath + File.separator) || file.path.startsWith(context.cacheDir.canonicalPath + File.separator)) { "Use a file attached in Neru." }
    require(file.isFile) { "This file is no longer available. Attach it again." }
    require(file.length() <= MAX_FILE) { "Documents can be up to 50 MB. Split this file into smaller documents." }
    val extension = name.substringAfterLast('.', "").lowercase()
    val kind = when {
      extension in setOf("pdf", "doc", "docx", "docm", "ppt", "pptx", "pptm", "xls", "xlsx", "xlsm", "odt", "ods", "odp", "rtf") -> extension
      mime == "application/pdf" -> "pdf"
      mime.contains("wordprocessingml") -> "docx"
      mime.contains("presentationml") -> "pptx"
      mime.contains("spreadsheetml") -> "xlsx"
      mime == "application/msword" -> "doc"
      mime == "application/vnd.ms-powerpoint" -> "ppt"
      mime == "application/vnd.ms-excel" -> "xls"
      mime == "application/rtf" -> "rtf"
      mime.startsWith("text/") -> "txt"
      else -> extension.ifEmpty { "unknown" }
    }
    val text = Text()
    try {
      when (kind) {
        "pdf" -> pdf(context, file, text)
        "docx", "docm", "pptx", "pptm", "xlsx", "xlsm", "odt", "ods", "odp" -> ZipFile(file).use { zip ->
          require(zip.size() <= 10_000) { "This document contains too many embedded files." }
          when (kind) {
            "docx", "docm" -> {
              xmlText(zip, "word/document.xml", text)
              zip.entries().asSequence().filter { it.name.matches(Regex("word/(header\\d+|footer\\d+|footnotes|endnotes)\\.xml")) }.forEach { xmlText(zip, it.name, text) }
            }
            "pptx", "pptm" -> slides(zip, text)
            "xlsx", "xlsm" -> sheets(zip, text)
            else -> xmlText(zip, "content.xml", text)
          }
        }
        "doc" -> { require(file.length() <= 10 * 1024 * 1024) { "Legacy Word files can be up to 10 MB. Save a larger file as DOCX." }; file.inputStream().use { input -> WordExtractor(input).use { text.add(it.text) } } }
        "xls" -> { require(file.length() <= 10 * 1024 * 1024) { "Legacy Excel files can be up to 10 MB. Save a larger file as XLSX." }; POIFSFileSystem(file, true).use { fs -> EventBasedExcelExtractor(fs).use { text.add(it.text) } } }
        "ppt" -> legacySlides(file, text)
        "rtf" -> {
          require(file.length() <= 2 * 1024 * 1024) { "RTF files can be up to 2 MB. Save a larger file as DOCX or PDF." }
          val raw = file.readText(Charsets.ISO_8859_1)
          text.add(raw.replace(Regex("\\\\u(-?\\d+)\\??")) { ((it.groupValues[1].toInt() + 65536) % 65536).toChar().toString() }
            .replace(Regex("\\\\'(\\p{XDigit}{2})")) { it.groupValues[1].toInt(16).toChar().toString() }
            .replace(Regex("\\\\(par|line)\\b ?"), "\n").replace(Regex("\\\\tab\\b ?"), "\t")
            .replace(Regex("\\\\[a-zA-Z]+-?\\d* ?"), "").replace(Regex("[{}]"), ""))
        }
        else -> {
          require(mime.startsWith("text/") || kind in setOf("txt", "md", "csv", "tsv", "json", "xml", "yaml", "yml", "toml", "html", "htm", "log", "js", "ts", "tsx", "jsx", "py", "rs", "go", "java", "kt", "swift", "c", "cpp", "h", "cs", "rb", "php", "sh", "sql", "css")) { "This file type cannot be read as text. Use PDF, Word, PowerPoint, Excel, CSV or a text file." }
          file.bufferedReader().use { reader -> val buffer = CharArray(8192); while (true) { val n = reader.read(buffer); if (n < 0) break; text.add(String(buffer, 0, n)) } }
        }
      }
    } catch (_: Full) { text.truncated = true }
    val body = text.value.toString().replace(Regex("\n{3,}"), "\n\n").trim()
    require(body.isNotBlank()) { "No readable text was found. The file may be encrypted, empty, or contain images that OCR could not recognize." }
    return mapOf("text" to (body + if (text.truncated) "\n[Document text truncated at $LIMIT characters.]" else ""), "truncated" to text.truncated, "format" to kind)
  }

  private fun xml(zip: ZipFile, path: String, visit: (XmlPullParser, Int) -> Unit) {
    val entry = zip.getEntry(path) ?: return
    require(entry.size <= XML_LIMIT) { "A document section is too large to extract safely." }
    zip.getInputStream(entry).use { raw ->
      val bounded = object : FilterInputStream(raw) {
        var count = 0
        override fun read(): Int { val n = super.read(); if (n >= 0) count++; require(count <= XML_LIMIT); return n }
        override fun read(b: ByteArray, off: Int, len: Int): Int { val n = `in`.read(b, off, len); if (n > 0) count += n; require(count <= XML_LIMIT); return n }
      }
      val factory = XmlPullParserFactory.newInstance().apply { isNamespaceAware = true }
      val parser = factory.newPullParser()
      parser.setFeature(XmlPullParser.FEATURE_PROCESS_DOCDECL, false)
      parser.setInput(bounded, null)
      while (parser.eventType != XmlPullParser.END_DOCUMENT) { visit(parser, parser.eventType); parser.next() }
    }
  }
  private fun attr(p: XmlPullParser, name: String): String? {
    val indexes = (0 until p.attributeCount).filter { p.getAttributeName(it) == name }
    val index = indexes.firstOrNull { p.getAttributeNamespace(it).contains("relationships") } ?: indexes.firstOrNull()
    return index?.let { p.getAttributeValue(it) }
  }
  private fun xmlText(zip: ZipFile, path: String, out: Text) {
    var textDepth = 0
    xml(zip, path) { p, event ->
      when (event) {
        XmlPullParser.START_TAG -> when (p.name) { "t", "instrText", "p", "h" -> textDepth++; "tab" -> out.add("\t"); "br", "cr", "line-break" -> out.add("\n") }
        XmlPullParser.TEXT -> if (textDepth > 0) out.add(p.text)
        XmlPullParser.END_TAG -> { if (p.name in setOf("p", "h")) out.add("\n"); if (p.name in setOf("t", "instrText", "p", "h")) textDepth-- }
      }
    }
  }
  private fun relations(zip: ZipFile, path: String, base: String): Map<String, String> {
    val result = mutableMapOf<String, String>()
    xml(zip, path) { p, e -> if (e == XmlPullParser.START_TAG && p.name == "Relationship" && attr(p, "TargetMode") != "External") {
      val id = attr(p, "Id"); val target = attr(p, "Target")
      if (id != null && target != null) result[id] = (if (target.startsWith('/')) java.nio.file.Paths.get(target.removePrefix("/")) else java.nio.file.Paths.get(base).resolve(target)).normalize().toString().replace('\\', '/')
    } }
    return result
  }
  private fun slides(zip: ZipFile, out: Text) {
    val rels = relations(zip, "ppt/_rels/presentation.xml.rels", "ppt")
    val ordered = mutableListOf<String>()
    xml(zip, "ppt/presentation.xml") { p, e -> if (e == XmlPullParser.START_TAG && p.name == "sldId") attr(p, "id")?.let { rels[it] }?.let { ordered.add(it) } }
    val names = ordered.ifEmpty { zip.entries().asSequence().map { it.name }.filter { it.matches(Regex("ppt/slides/slide\\d+\\.xml")) }.sortedBy { Regex("(\\d+)\\.xml").find(it)?.groupValues?.get(1)?.toInt() ?: 0 }.toList() }
    for ((index, path) in names.withIndex()) {
      out.add("\n[Slide ${index + 1}]\n"); xmlText(zip, path, out)
      val leaf = path.substringAfterLast('/')
      val notes = relations(zip, "ppt/slides/_rels/$leaf.rels", "ppt/slides").values.firstOrNull { it.startsWith("ppt/notesSlides/") }
      if (notes != null) { out.add("\n[Speaker notes]\n"); xmlText(zip, notes, out) }
    }
  }
  private fun sheets(zip: ZipFile, out: Text) {
    val shared = mutableListOf<String>(); var item: StringBuilder? = null; var inText = false; var sharedSize = 0
    xml(zip, "xl/sharedStrings.xml") { p, e ->
      if (e == XmlPullParser.START_TAG && p.name == "si") item = StringBuilder()
      if (e == XmlPullParser.START_TAG && p.name == "t") inText = true
      if (e == XmlPullParser.TEXT && inText) { item?.append(p.text); require((item?.length ?: 0) <= LIMIT) }
      if (e == XmlPullParser.END_TAG && p.name == "t") inText = false
      if (e == XmlPullParser.END_TAG && p.name == "si") { sharedSize += item?.length ?: 0; require(shared.size < 50_000 && sharedSize <= 2_000_000) { "This spreadsheet has too much shared text. Split it into smaller files." }; shared.add(item.toString()); item = null }
    }
    val rels = relations(zip, "xl/_rels/workbook.xml.rels", "xl")
    val sheets = mutableListOf<Pair<String, String>>()
    xml(zip, "xl/workbook.xml") { p, e -> if (e == XmlPullParser.START_TAG && p.name == "sheet") { val path = attr(p, "id")?.let { rels[it] }; if (path != null) sheets.add((attr(p, "name") ?: "Sheet") to path) } }
    if (sheets.isEmpty()) zip.entries().asSequence().map { it.name }.filter { it.matches(Regex("xl/worksheets/sheet\\d+\\.xml")) }.sorted().forEach { sheets.add(it.substringAfterLast('/') to it) }
    for ((name, path) in sheets) {
      out.add("\n[Sheet $name]\n")
      var cell = ""; var type = ""; var value = StringBuilder(); var formula = StringBuilder(); var field = ""
      xml(zip, path) { p, e -> when (e) {
        XmlPullParser.START_TAG -> when (p.name) {
          "c" -> { cell = attr(p, "r") ?: "cell"; type = attr(p, "t") ?: ""; value = StringBuilder(); formula = StringBuilder() }
          "v", "t", "f" -> field = p.name
        }
        XmlPullParser.TEXT -> { if (field == "f") formula.append(p.text) else if (field == "v" || field == "t") value.append(p.text) }
        XmlPullParser.END_TAG -> when (p.name) {
          "v", "t", "f" -> field = ""
          "c" -> { val v = if (type == "s") shared.getOrNull(value.toString().toIntOrNull() ?: -1) ?: "" else value.toString(); if (v.isNotEmpty() || formula.isNotEmpty()) out.add("$cell: $v${if (formula.isNotEmpty()) " [=$formula]" else ""}\t") }
          "row" -> out.add("\n")
        }
      } }
    }
  }
  private fun legacySlides(file: File, out: Text) {
    require(file.length() <= 10 * 1024 * 1024) { "Legacy PowerPoint files can be up to 10 MB. Save a larger file as PPTX." }
    POIFSFileSystem(file, true).use { fs -> fs.createDocumentInputStream("PowerPoint Document").use { input ->
      val bytes = input.readBytes(); var at = 0; val seen = mutableSetOf<String>()
      fun u16(i: Int) = (bytes[i].toInt() and 255) or ((bytes[i + 1].toInt() and 255) shl 8)
      while (at + 8 <= bytes.size) {
        val type = u16(at + 2); val length = java.nio.ByteBuffer.wrap(bytes, at + 4, 4).order(java.nio.ByteOrder.LITTLE_ENDIAN).int
        if (length < 0 || length > bytes.size - at - 8) break
        if ((u16(at) and 15) == 15) { at += 8; continue }
        if (type == 4000 || type == 4008) {
          val value = String(bytes, at + 8, length, if (type == 4000) Charsets.UTF_16LE else charset("windows-1252")).replace('\r', '\n').replace('\u000b', '\n').replace("\u0000", "").trim()
          if (value.isNotEmpty() && seen.add(value)) out.add("$value\n")
        }
        at += 8 + length
      }
    } }
  }
  private fun pdf(context: Context, file: File, out: Text) {
    PDFBoxResourceLoader.init(context.applicationContext)
    PDDocument.load(file, MemoryUsageSetting.setupTempFileOnly().setTempDir(context.cacheDir)).use { document ->
      require(!document.isEncrypted || document.currentAccessPermission.canExtractContent()) { "This PDF does not allow text extraction." }
      val stripper = PDFTextStripper().apply { sortByPosition = true }
      var renderer: PdfRenderer? = null
      val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
      try {
        for (page in 1..minOf(document.numberOfPages, 100)) {
          stripper.startPage = page; stripper.endPage = page
          val writer = object : StringWriter() { override fun write(chars: CharArray, offset: Int, length: Int) { require(buffer.length + length <= LIMIT) { "A PDF page contains too much text." }; super.write(chars, offset, length) } }
          stripper.writeText(document, writer)
          var body = writer.toString().trim()
          if (body.isEmpty()) {
            if (renderer == null) renderer = PdfRenderer(ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY))
            renderer!!.openPage(page - 1).use { image ->
              val scale = minOf(2f, 1600f / maxOf(image.width, image.height))
              val bitmap = Bitmap.createBitmap((image.width * scale).toInt().coerceAtLeast(1), (image.height * scale).toInt().coerceAtLeast(1), Bitmap.Config.ARGB_8888)
              try { bitmap.eraseColor(Color.WHITE); image.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY); body = Tasks.await(recognizer.process(InputImage.fromBitmap(bitmap, 0)), 30, TimeUnit.SECONDS).text }
              finally { bitmap.recycle() }
            }
          }
          if (body.isNotBlank()) out.add("[Page $page]\n$body\n\n")
        }
        if (document.numberOfPages > 100) { out.truncated = true }
      } finally { renderer?.close(); recognizer.close() }
    }
  }
}
