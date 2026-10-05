package dev.neru.localai

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * Keeps Neru running while a Pocket Lab model downloads, so leaving the app or switching screens doesn't stop it,
 * and shows the download in the notification shade with its progress. The download itself stays in JS; this
 * service only holds the process at foreground priority and owns the notification.
 */
class DownloadService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val notification = build(this, intent?.getStringExtra(EXTRA_TITLE) ?: "Downloading a model", intent?.getStringExtra(EXTRA_TEXT) ?: "Starting…", -1)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    else startForeground(ID, notification)
    return START_NOT_STICKY
  }

  // Android 15 caps data-sync services at six hours a day; a model never needs that long, but stop cleanly if so.
  override fun onTimeout(startId: Int, fgsType: Int) = stopSelf()

  companion object {
    const val ID = 4107
    private const val DONE_ID = 4108
    private const val CHANNEL = "neru-downloads"
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_TEXT = "text"

    private fun manager(context: Context) = context.getSystemService(NotificationManager::class.java)

    private fun channel(context: Context) {
      // Low importance: a progress bar in the shade, no sound or pop-up on every update.
      manager(context).createNotificationChannel(NotificationChannel(CHANNEL, "Model downloads", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Progress of Pocket Lab models downloading to this phone"
      })
    }

    private fun openApp(context: Context): PendingIntent? =
      context.packageManager.getLaunchIntentForPackage(context.packageName)?.let {
        PendingIntent.getActivity(context, 0, it.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      }

    /** `percent` below 0 shows an indeterminate bar; null shows none. */
    fun build(context: Context, title: String, text: String, percent: Int?, done: Boolean = false): Notification {
      channel(context)
      return Notification.Builder(context, CHANNEL)
        .setSmallIcon(if (done) android.R.drawable.stat_sys_download_done else android.R.drawable.stat_sys_download)
        .setContentTitle(title)
        .setContentText(text)
        .setContentIntent(openApp(context))
        .setOnlyAlertOnce(true)
        .setOngoing(!done)
        .setAutoCancel(done)
        .setCategory(if (done) Notification.CATEGORY_STATUS else Notification.CATEGORY_PROGRESS)
        .apply { if (percent != null) setProgress(100, percent.coerceIn(0, 100), percent < 0) }
        .apply { if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !done) setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE) }
        .build()
    }

    fun start(context: Context, title: String, text: String) {
      val intent = Intent(context, DownloadService::class.java).putExtra(EXTRA_TITLE, title).putExtra(EXTRA_TEXT, text)
      context.startForegroundService(intent)
    }

    fun update(context: Context, title: String, text: String, percent: Int) {
      if (manager(context).areNotificationsEnabled()) manager(context).notify(ID, build(context, title, text, percent))
    }

    /** Ends the service; with a `title`, leaves a tappable "downloaded" (or "failed") note behind. */
    fun finish(context: Context, title: String?, text: String?) {
      context.stopService(Intent(context, DownloadService::class.java))
      manager(context).cancel(ID)
      if (title != null && manager(context).areNotificationsEnabled()) manager(context).notify(DONE_ID, build(context, title, text ?: "", null, done = true))
    }
  }
}
