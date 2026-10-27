package dev.neru.localai

import com.google.ai.edge.litertlm.*
import android.app.ActivityManager
import android.content.ComponentCallbacks2
import android.content.res.Configuration
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
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.net.URI
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * All inference stays on this phone. One engine, bounded context, serialized lifecycle. Like Edge Gallery, the chat's
 * conversation stays alive between turns, so each reply only reads the new message instead of the whole history.
 */
@OptIn(ExperimentalApi::class)
class NeruLocalAiModule : Module() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val lock = Mutex()
  private val documentLock = Mutex()
  private val google = GoogleAuthorization()
  private var engine: Engine? = null
  private var loadedPath = ""
  @Volatile private var conversation: Conversation? = null
  private val cancelled = AtomicBoolean(false)
  // The conversation kept between turns: what it was made with, and the turns it has already read.
  private var live: Conversation? = null
  private var liveKey = ""
  private var liveTurns: List<String> = emptyList()
  @Volatile private var background = false
  private var backgroundRelease: Job? = null

  // When Android runs short of memory, give the model back rather than have Neru killed (never mid-reply).
  private val memory = object : ComponentCallbacks2 {
    override fun onTrimMemory(level: Int) {
      @Suppress("DEPRECATION")
      if (level == ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW || level == ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL || level >= ComponentCallbacks2.TRIM_MEMORY_MODERATE) freeIfIdle()
    }
    override fun onLowMemory() = freeIfIdle()
    override fun onConfigurationChanged(newConfig: Configuration) {}
  }

  private fun freeIfIdle() {
    scope.launch { if (lock.tryLock()) try { release() } finally { lock.unlock() } }
  }

  /** Closes the kept conversation and the engine. Call with the lock held. */
  private fun release() {
    live?.close(); live = null; liveKey = ""; liveTurns = emptyList()
    engine?.close(); engine = null; loadedPath = ""
  }

  /** Loads the model unless it is already loaded with these settings. Call with the lock held, off the main thread. */
  private fun ensureEngine(context: android.content.Context, requestId: String?, file: File, settings: Map<String, Any?>): String {
    val accelerator = settings["accelerator"] as? String ?: "cpu"
    val contextTokens = (settings["contextTokens"] as? Number)?.toInt() ?: 4096
    require(contextTokens in 512..32000) { "Use 512–32000 context tokens." }
    val vision = settings["vision"] == true
    val engineKey = "${file.path}|$accelerator|$contextTokens|$vision"
    if (engine != null && loadedPath == engineKey) return engineKey
    release()
    // A model needs much of its size in free memory; starting short gets Neru killed instead of answering.
    val info = ActivityManager.MemoryInfo().also { (context.getSystemService(android.content.Context.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(it) }
    if (info.lowMemory || info.availMem < file.length() * 35 / 100) error("Not enough free memory to load this model. Close a few apps, or pick a smaller model.")
    requestId?.let { sendEvent("status", mapOf("requestId" to it, "phase" to "loading")) }
    // Leave two cores to the interface so scrolling and typing stay smooth while the model works.
    val threads = (Runtime.getRuntime().availableProcessors() - 2).coerceIn(1, 4)
    val started = System.nanoTime()
    fun start(backend: Backend, visionBackend: Backend?): Engine {
      val next = Engine(EngineConfig(modelPath = file.path, backend = backend, visionBackend = visionBackend, maxNumTokens = contextTokens, cacheDir = context.cacheDir.path))
      try { next.initialize() } catch (e: Throwable) { next.close(); throw e }
      return next
    }
    fun cpu() = Backend.CPU(threads)
    // GPU when asked, falling back to the CPU when this phone's GPU refuses the model. Image models need a vision
    // encoder backend; Edge Gallery runs it on GPU.
    val text = { visionBackend: Backend? -> if (accelerator == "gpu") try { start(Backend.GPU(), visionBackend) } catch (e: Throwable) { start(cpu(), visionBackend) } else start(cpu(), visionBackend) }
    engine = if (!vision) text(null) else try { text(Backend.GPU()) } catch (e: Throwable) { text(cpu()) }
    loadedPath = engineKey
    android.util.Log.d("NeruLocalAi", "Engine loaded in ${(System.nanoTime() - started) / 1_000_000} ms; cpuThreads=$threads; context=$contextTokens")
    return engineKey
  }

  override fun definition() = ModuleDefinition {
    Name("NeruLocalAi")
    Events("token", "status")
    OnCreate { appContext.reactContext?.registerComponentCallbacks(memory) }
    OnActivityResult { activity, result -> google.onResult(activity, result.requestCode, result.resultCode, result.data) }
    AsyncFunction("authorizeGoogle") { scopes: List<String>, interactive: Boolean, promise: Promise -> google.authorize(appContext.currentActivity, scopes, interactive, promise) }
    Function("googleAuthInfo") { GoogleAuthorization.info(appContext.reactContext ?: error("Neru is not ready.")) }
    AsyncFunction("readDocument") Coroutine { uri: String, name: String, mime: String ->
      documentLock.withLock { withContext(Dispatchers.IO) { DocumentReader.read(appContext.reactContext ?: error("Neru is not ready."), uri, name, mime) } }
    }
    OnActivityEntersForeground { background = false; backgroundRelease?.cancel() }
    OnActivityEntersBackground {
      background = true
      backgroundRelease?.cancel()
      backgroundRelease = scope.launch {
        delay(60_000)
        // Wait for a reply to finish. Returning to Neru cancels this wait and keeps the engine warm.
        lock.withLock { if (background) { release(); android.util.Log.d("NeruLocalAi", "Released background engine") } }
      }
    }
    AsyncFunction("segment") Coroutine { modelUri: String, imageUri: String, x: Double, y: Double, accelerator: String ->
      lock.withLock { withContext(Dispatchers.IO) {
        require(x.isFinite() && y.isFinite() && x in 0.0..1.0 && y in 0.0..1.0)
        require(accelerator == "cpu" || accelerator == "gpu")
        val context = appContext.reactContext ?: error("Neru is not ready.")
        val model = File(URI(modelUri)).canonicalFile
        val imageFile = File(URI(imageUri)).canonicalFile
        require(model.path.startsWith(context.filesDir.canonicalPath + File.separator) && model.isFile)
        require(imageFile.path.startsWith(context.cacheDir.canonicalPath + File.separator) || imageFile.path.startsWith(context.filesDir.canonicalPath + File.separator))
        release()
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
        require(file.path.startsWith(context.filesDir.canonicalPath + File.separator) || file.path.startsWith(context.cacheDir.canonicalPath + File.separator))
        val digest = java.security.MessageDigest.getInstance("SHA-256")
        file.inputStream().buffered().use { input ->
          val buffer = ByteArray(1024 * 1024)
          while (true) { val count = input.read(buffer); if (count < 0) break; digest.update(buffer, 0, count) }
        }
        digest.digest().joinToString("") { "%02x".format(it) }.equals(hash, ignoreCase = true)
      }
    }
    AsyncFunction("generate") Coroutine { requestId: String, uri: String, messages: List<Map<String, Any?>>, settings: Map<String, Any?> ->
      lock.withLock {
        cancelled.set(false)
        val context = appContext.reactContext ?: error("Neru is not ready.")
        val file = File(URI(uri)).canonicalFile
        require(file.path.startsWith(context.filesDir.canonicalPath + File.separator)) { "Use a model downloaded by Neru." }
        require(file.isFile && file.name.endsWith(".litertlm")) { "Download this model first." }
        try {
          withContext(Dispatchers.IO) {
            val contextTokens = (settings["contextTokens"] as? Number)?.toInt() ?: 4096
            val maxTokens = (settings["maxTokens"] as? Number)?.toInt() ?: 1024
            require(contextTokens in 512..32000 && maxTokens in 1..contextTokens)
            val vision = settings["vision"] == true
            val engineKey = ensureEngine(context, requestId, file, settings)
            if (cancelled.get()) return@withContext
            val history = messages.filter { it["role"] != "system" }
            require(history.isNotEmpty() && history.last()["role"] == "user") { "A user message is required." }
            // Room for the reply: never more than three quarters of the context, so the question always fits.
            val maxOut = minOf(maxTokens, contextTokens / 2)
            fun images(m: Map<String, Any?>) = (m["images"] as? List<*>).orEmpty().map { it as String }
            fun text(m: Map<String, Any?>) = m["text"] as? String ?: ""
            fun turn(m: Map<String, Any?>) = "${m["role"]}\u0000${text(m)}\u0000${images(m).joinToString("\u0000")}"
            // Rough tokens for a turn: about three characters each, a few hundred per image.
            fun cost(m: Map<String, Any?>) = text(m).length / 3 + images(m).size * 300 + 8
            fun contents(m: Map<String, Any?>, budget: Int = Int.MAX_VALUE): Contents {
              val pics = images(m)
              require(pics.isEmpty() || vision) { "This model reads text only." }
              var body = text(m)
              // One very long message (a pasted file) keeps its start and end instead of overflowing the context.
              val textRoom = (budget - pics.size * 300 - 8).coerceAtLeast(0)
              if (body.length / 3 > textRoom) body = clipPrompt(body, textRoom * 3)
              // Images first, then the text, as Edge Gallery sends them.
              return Contents.of(pics.map { Content.ImageBytes(imageBytes(context, it)) } + Content.Text(body))
            }
            val system = clipPrompt(settings["systemPrompt"] as? String ?: "You are Neru, a helpful assistant.", contextTokens / 4 * 3)
            val promptBudget = contextTokens - maxOut - system.length / 3 - 64
            val past = history.dropLast(1)
            val pastTurns = past.map(::turn)
            val question = history.last()
            require(promptBudget > images(question).size * 300 + 8) { "Too many images for this context. Increase the context or send fewer images." }
            val questionBudget = minOf(cost(question), promptBudget)
            val chatKey = listOf(engineKey, system, settings["topK"], settings["topP"], settings["temperature"], maxOut, settings["thinking"], settings["speculative"]).joinToString("|")
            // The same chat one turn later: the kept conversation already read everything before this question.
            val reuse = live?.takeIf { settings["reuseConversation"] != false && it.isAlive && liveKey == chatKey && liveTurns == pastTurns && it.getTokenCount() + cost(question) + maxOut < contextTokens }
            val chat = reuse ?: run {
              live?.close(); live = null
              // The newest turns that fit, oldest dropped first.
              var room = promptBudget - questionBudget
              val kept = past.takeLast(12).asReversed().takeWhile { room -= cost(it); room >= 0 }.asReversed()
              val initial = kept.map { if (it["role"] == "assistant") Message.model(text(it)) else Message.user(contents(it)) }
              // LiteRT-LM takes speculative decoding as a process-wide experimental flag, not per conversation.
              ExperimentalFlags.enableSpeculativeDecoding = settings["speculative"] == true
              engine!!.createConversation(ConversationConfig(systemInstruction = Contents.of(system), initialMessages = initial, automaticToolCalling = false,
                samplerConfig = SamplerConfig(topK = (settings["topK"] as? Number)?.toInt() ?: 64, topP = (settings["topP"] as? Number)?.toDouble() ?: 0.95, temperature = (settings["temperature"] as? Number)?.toDouble() ?: 1.0),
                maxOutputToken = maxOut, thinkingConfig = ThinkingConfig(enableThinking = settings["thinking"] == true))).also { live = it; liveKey = chatKey }
            }
            android.util.Log.d("NeruLocalAi", "Conversation reused=${reuse != null}; promptBudget=$promptBudget; maxOutput=$maxOut")
            conversation = chat
            val reply = StringBuilder()
            var ok = false
            var structuredToolCall = false
            try {
              if (!cancelled.get()) {
                sendEvent("status", mapOf("requestId" to requestId, "phase" to "generating"))
                // Tokens go to the app in batches about 25 times a second, not one bridge message each.
                val text = StringBuilder()
                val thought = StringBuilder()
                var sentAt = 0L
                fun flush() {
                  if (text.isEmpty() && thought.isEmpty()) return
                  sendEvent("token", mapOf("requestId" to requestId, "text" to text.toString(), "reasoning" to thought.toString()))
                  text.setLength(0); thought.setLength(0); sentAt = System.nanoTime()
                }
                // Some converted chat templates default back to thinking on each send. Carry the explicit switch
                // on every turn, both through LiteRT's thinking control and the template's enable_thinking value.
                chat.sendMessageAsync(contents(question, promptBudget),
                  extraContext = mapOf("enable_thinking" to (settings["thinking"] == true)),
                  thinkingConfig = ThinkingConfig(enableThinking = settings["thinking"] == true)).collect { message ->
                  if (cancelled.get()) { chat.cancelProcess(); return@collect }
                  // Gemma may return structured native calls instead of text. Send those to Neru's MCP executor
                  // and approval flow; Message.toString() alone silently discards them.
                  if (message.toolCalls.isNotEmpty()) structuredToolCall = true
                  val piece = message.toString() + message.toolCalls.joinToString("") { call ->
                    "<tool_call>" + org.json.JSONObject(mapOf("name" to call.name, "arguments" to call.arguments)).toString() + "</tool_call>"
                  }
                  reply.append(piece); text.append(piece)
                  thought.append(message.channels["analysis"] ?: message.channels["thought"] ?: "")
                  if (System.nanoTime() - sentAt > 40_000_000L) flush()
                }
                flush()
                ok = !cancelled.get()
              }
            } finally {
              // A stopped or failed reply leaves the conversation in an unknown state: start the next one fresh.
              // The app keeps the answer without inline <think> reasoning, so the turn is remembered the same way.
              // Structured calls leave LiteRT waiting for a native tool-role response. Neru sends MCP results via
              // its compact text protocol, so rebuild that conversation from the supplied history on the next round.
              if (ok && !structuredToolCall) liveTurns = pastTurns + turn(question) + turn(mapOf("role" to "assistant", "text" to reply.toString().replace(THINK, "")))
              else { chat.close(); if (live === chat) { live = null; liveTurns = emptyList() } }
            }
          }
        } finally { conversation = null }
      }
    }
    // Loads a model ahead of the first message (when it is picked, or the user starts typing), so replies start fast.
    AsyncFunction("load") Coroutine { uri: String, settings: Map<String, Any?> ->
      // Preloading is optional: never wait behind generation and evict its engine after the reply.
      if (background || !lock.tryLock()) return@Coroutine
      try {
        val context = appContext.reactContext ?: error("Neru is not ready.")
        val file = File(URI(uri)).canonicalFile
        require(file.path.startsWith(context.filesDir.canonicalPath + File.separator) && file.isFile && file.name.endsWith(".litertlm")) { "Download this model first." }
        withContext(Dispatchers.IO) { ensureEngine(context, null, file, settings) }
        Unit
      } finally { lock.unlock() }
    }
    // Pocket Lab downloads: a foreground service with a progress notification, so they carry on in the background.
    Function("downloadStart") { title: String, text: String ->
      val context = appContext.reactContext ?: return@Function false
      runCatching { DownloadService.start(context, title, text) }.isSuccess
    }
    Function("downloadProgress") { title: String, text: String, percent: Int ->
      appContext.reactContext?.let { DownloadService.update(it, title, text, percent) }
    }
    Function("downloadFinish") { title: String?, text: String? ->
      appContext.reactContext?.let { DownloadService.finish(it, title, text) }
    }
    // React Native pauses JS timers while the app is in the background; this wait keeps going, so a dropped
    // connection still retries with Neru out of sight.
    AsyncFunction("wait") Coroutine { ms: Double -> delay(ms.toLong().coerceIn(0, 60_000)) }
    Function("cancel") {
      cancelled.set(true)
      conversation?.cancelProcess()
    }
    AsyncFunction("unload") Coroutine { ->
      lock.withLock { withContext(Dispatchers.IO) { release() } }
    }
    OnDestroy {
      google.close()
      cancelled.set(true)
      conversation?.cancelProcess()
      runCatching { appContext.reactContext?.unregisterComponentCallbacks(memory) }
      scope.launch { lock.withLock { release() }; scope.cancel() }
    }
  }

  /** A picked photo, downscaled to a long edge of at most 1024 px and re-encoded as PNG so memory stays bounded. */
  private fun imageBytes(context: android.content.Context, uri: String): ByteArray {
    val file = File(URI(uri)).canonicalFile
    require((file.path.startsWith(context.cacheDir.canonicalPath + File.separator) || file.path.startsWith(context.filesDir.canonicalPath + File.separator)) && file.isFile) { "This image is no longer available." }
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, bounds)
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= MAX_EDGE) sample *= 2
    val decoded = BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample }) ?: error("This image could not be opened.")
    // Camera photos are often stored sideways with an EXIF orientation; the model must see them upright.
    val degrees = when (android.media.ExifInterface(file.path).getAttributeInt(android.media.ExifInterface.TAG_ORIENTATION, android.media.ExifInterface.ORIENTATION_NORMAL)) {
      android.media.ExifInterface.ORIENTATION_ROTATE_90 -> 90f
      android.media.ExifInterface.ORIENTATION_ROTATE_180 -> 180f
      android.media.ExifInterface.ORIENTATION_ROTATE_270 -> 270f
      else -> 0f
    }
    val scale = minOf(1f, MAX_EDGE.toFloat() / maxOf(decoded.width, decoded.height))
    val matrix = android.graphics.Matrix().apply { postScale(scale, scale); postRotate(degrees) }
    val bitmap = if (scale < 1f || degrees != 0f) Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true) else decoded
    try {
      return java.io.ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
    } finally { if (bitmap !== decoded) bitmap.recycle(); decoded.recycle() }
  }

  private companion object {
    const val MAX_EDGE = 1024
    val THINK = Regex("<think>[\\s\\S]*?(</think>|$)")
    fun clipPrompt(text: String, maxChars: Int): String {
      if (text.length <= maxChars) return text
      val marker = "\n[…]\n"
      if (maxChars <= marker.length) return text.take(maxChars.coerceAtLeast(0))
      val head = (maxChars - marker.length) / 2
      return text.take(head) + marker + text.takeLast(maxChars - marker.length - head)
    }
  }
}
