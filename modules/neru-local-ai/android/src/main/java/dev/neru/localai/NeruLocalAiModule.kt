package dev.neru.localai

import com.google.ai.edge.litertlm.*
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.framework.image.ByteBufferExtractor
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.components.containers.NormalizedKeypoint
import com.google.mediapipe.tasks.vision.interactivesegmenter.InteractiveSegmenter
import com.google.mediapipe.tasks.vision.interactivesegmenter.InteractiveSegmenterOptions
import com.google.mediapipe.tasks.vision.interactivesegmenter.Stroke
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.net.URI
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** All inference stays on this phone. One engine, bounded context, serialized lifecycle. */
class NeruLocalAiModule : Module() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val lock = Mutex()
  private var engine: Engine? = null
  private var loadedPath = ""
  @Volatile private var conversation: Conversation? = null
  private val cancelled = AtomicBoolean(false)

  override fun definition() = ModuleDefinition {
    Name("NeruLocalAi")
    Events("token", "status")
    AsyncFunction("segment") Coroutine { modelUri: String, imageUri: String, x: Double, y: Double, accelerator: String ->
      lock.withLock { withContext(Dispatchers.IO) {
        require(x.isFinite() && y.isFinite() && x in 0.0..1.0 && y in 0.0..1.0)
        require(accelerator == "cpu" || accelerator == "gpu")
        val context = appContext.reactContext ?: error("Neru is not ready.")
        val model = File(URI(modelUri)).canonicalFile
        val imageFile = File(URI(imageUri)).canonicalFile
        require(model.path.startsWith(context.filesDir.canonicalPath + File.separator) && model.isFile)
        require(imageFile.path.startsWith(context.cacheDir.canonicalPath + File.separator) || imageFile.path.startsWith(context.filesDir.canonicalPath + File.separator))
        engine?.close(); engine = null; loadedPath = ""
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(imageFile.path, bounds)
        val options = BitmapFactory.Options().apply { inSampleSize = (maxOf(bounds.outWidth, bounds.outHeight) / 1600).coerceAtLeast(1) }
        val bitmap = BitmapFactory.decodeFile(imageFile.path, options) ?: error("This image could not be opened.")
        val image = BitmapImageBuilder(bitmap).build()
        try {
          val base = BaseOptions.builder().setModelAssetPath(model.path).setDelegate(if (accelerator == "gpu") Delegate.GPU else Delegate.CPU).build()
          InteractiveSegmenter.createFromOptions(context, InteractiveSegmenterOptions.builder().setBaseOptions(base).build()).use { segmenter ->
            segmenter.setImage(image)
            val stroke = Stroke.builder().setBrushMode(Stroke.BrushMode.POSITIVE).setPoints(listOf(NormalizedKeypoint.create(x.toFloat(), y.toFloat()))).setCompleted(true).build()
            val mask = segmenter.segment(listOf(stroke))
            try {
              val values = ByteBufferExtractor.extract(mask).order(java.nio.ByteOrder.nativeOrder()).asFloatBuffer()
              val pixels = IntArray(bitmap.width * bitmap.height)
              bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
              require(values.remaining() == pixels.size) { "Unexpected segmentation dimensions." }
              var confidence = 0f
              for (i in pixels.indices) {
                val alpha = values.get().coerceIn(0f, 1f)
                confidence = maxOf(confidence, alpha)
                pixels[i] = (pixels[i] and 0x00ffffff) or ((alpha * 255).toInt() shl 24)
              }
              require(confidence > 0.01f) { "No object was found. Try another point or choose CPU." }
              val cutout = Bitmap.createBitmap(pixels, bitmap.width, bitmap.height, Bitmap.Config.ARGB_8888)
              try {
                val output = File(context.cacheDir, "magic-touch-${System.currentTimeMillis()}.png")
                output.outputStream().use { cutout.compress(Bitmap.CompressFormat.PNG, 100, it) }
                output.toURI().toString()
              } finally { cutout.recycle() }
            } finally { mask.close() }
          }
        } finally { image.close(); bitmap.recycle() }
      } }
    }
    AsyncFunction("verifyFile") Coroutine { uri: String, hash: String ->
      withContext(Dispatchers.IO) {
        val context = appContext.reactContext ?: error("Neru is not ready.")
        val file = File(URI(uri)).canonicalFile
        require(file.path.startsWith(context.filesDir.canonicalPath + File.separator))
        val digest = java.security.MessageDigest.getInstance("SHA-256")
        file.inputStream().buffered().use { input ->
          val buffer = ByteArray(1024 * 1024)
          while (true) { val count = input.read(buffer); if (count < 0) break; digest.update(buffer, 0, count) }
        }
        digest.digest().joinToString("") { "%02x".format(it) }.equals(hash, ignoreCase = true)
      }
    }
    AsyncFunction("generate") Coroutine { requestId: String, uri: String, messages: List<Map<String, String>>, settings: Map<String, Any?> ->
      lock.withLock {
        cancelled.set(false)
        val context = appContext.reactContext ?: error("Neru is not ready.")
        val file = File(URI(uri)).canonicalFile
        require(file.path.startsWith(context.filesDir.canonicalPath + File.separator)) { "Use a model downloaded by Neru." }
        require(file.isFile && file.name.endsWith(".litertlm")) { "Download this model first." }
        try {
          withContext(Dispatchers.IO) {
            val accelerator = settings["accelerator"] as? String ?: "cpu"
            val contextTokens = (settings["contextTokens"] as? Number)?.toInt() ?: 4096
            val maxTokens = (settings["maxTokens"] as? Number)?.toInt() ?: 1024
            require(contextTokens in 512..32000 && maxTokens in 1..contextTokens)
            val engineKey = "${file.path}|$accelerator|$contextTokens"
            if (engine == null || loadedPath != engineKey) {
              engine?.close()
              engine = null
              loadedPath = ""
              sendEvent("status", mapOf("requestId" to requestId, "phase" to "loading"))
              val backend = if (accelerator == "gpu") Backend.GPU() else Backend.CPU()
              val next = Engine(EngineConfig(modelPath = file.path, backend = backend, maxNumTokens = contextTokens, cacheDir = context.cacheDir.path))
              try { next.initialize() } catch (e: Throwable) { next.close(); throw e }
              engine = next
              loadedPath = engineKey
            }
            if (cancelled.get()) return@withContext
            val history = messages.filter { it["role"] != "system" }
            require(history.isNotEmpty() && history.last()["role"] == "user") { "A user message is required." }
            val initial = history.dropLast(1).takeLast(12).map {
              if (it["role"] == "assistant") Message.model(it["text"] ?: "") else Message.user(it["text"] ?: "")
            }
            val system = settings["systemPrompt"] as? String ?: "You are Neru, a helpful assistant."
            val config = ConversationConfig(systemInstruction = Contents.of(system), initialMessages = initial,
              samplerConfig = SamplerConfig(topK = (settings["topK"] as? Number)?.toInt() ?: 64, topP = (settings["topP"] as? Number)?.toDouble() ?: 0.95, temperature = (settings["temperature"] as? Number)?.toDouble() ?: 1.0),
              maxOutputToken = maxTokens, thinkingConfig = ThinkingConfig(enableThinking = settings["thinking"] == true), enableSpeculativeDecoding = settings["speculative"] == true)
            engine!!.createConversation(config).use { chat ->
              conversation = chat
              if (!cancelled.get()) {
                sendEvent("status", mapOf("requestId" to requestId, "phase" to "generating"))
                chat.sendMessageAsync(history.last()["text"] ?: "").collect { message ->
                  if (cancelled.get()) chat.cancelProcess()
                  else sendEvent("token", mapOf("requestId" to requestId, "text" to message.toString(), "reasoning" to (message.channels["analysis"] ?: message.channels["thought"] ?: "")))
                }
              }
            }
          }
        } finally { conversation = null }
      }
    }
    Function("cancel") {
      cancelled.set(true)
      conversation?.cancelProcess()
    }
    AsyncFunction("unload") Coroutine {
      lock.withLock { withContext(Dispatchers.IO) { engine?.close(); engine = null; loadedPath = "" } }
    }
    OnDestroy {
      cancelled.set(true)
      conversation?.cancelProcess()
      scope.launch { lock.withLock { engine?.close(); engine = null }; scope.cancel() }
    }
  }
}
