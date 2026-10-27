package dev.neru.localai

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.Scope
import expo.modules.kotlin.Promise
import java.security.MessageDigest

/** Google authorization uses Play Services on Android, without an iOS browser callback or embedded secret. */
internal class GoogleAuthorization {
  private var pending: Promise? = null
  private var requested: List<String> = emptyList()
  fun authorize(activity: Activity?, scopes: List<String>, interactive: Boolean, promise: Promise) {
    if (activity == null) { promise.reject("GOOGLE_NOT_READY", "Open Neru before connecting Google.", null); return }
    activity.runOnUiThread {
      if (pending != null) { promise.reject("GOOGLE_BUSY", "A Google sign-in is already open.", null); return@runOnUiThread }
      if (GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(activity) != 0) {
        promise.reject("GOOGLE_PLAY_SERVICES", "Google Play services are required to connect a Google account on this device.", null); return@runOnUiThread
      }
      if (scopes.isEmpty() || scopes.any { !it.startsWith("https://www.googleapis.com/auth/") }) {
        promise.reject("GOOGLE_SCOPES", "This connector requested invalid Google permissions.", null); return@runOnUiThread
      }
      pending = promise; requested = scopes
      val request = AuthorizationRequest.builder().setRequestedScopes(scopes.map(::Scope)).build()
      Identity.getAuthorizationClient(activity).authorize(request)
        .addOnSuccessListener { result ->
          if (pending == null) return@addOnSuccessListener
          if (result.hasResolution()) {
            if (!interactive) fail("Sign in to Google again to grant this connector access.")
            else try { activity.startIntentSenderForResult(result.pendingIntent!!.intentSender, REQUEST, null, 0, 0, 0) }
            catch (e: Exception) { fail(e.message ?: "Could not open Google sign-in.", e) }
          } else finish(result)
        }
        .addOnFailureListener { error ->
          val detail = if (error is ApiException && error.statusCode == 10)
            "Google needs one-time setup: register Android app ${activity.packageName} with SHA-1 ${info(activity)["sha1"]} in Google Cloud and enable the Gmail, Drive or Calendar API."
          else error.message ?: "Google authorization failed."
          fail(detail, error)
        }
    }
  }
  fun onResult(activity: Activity, code: Int, result: Int, data: Intent?) {
    if (code != REQUEST || pending == null) return
    if (result != Activity.RESULT_OK || data == null) { fail("Google sign-in was cancelled."); return }
    try { finish(Identity.getAuthorizationClient(activity).getAuthorizationResultFromIntent(data)) }
    catch (e: Exception) { fail(e.message ?: "Google did not return authorization.", e) }
  }
  private fun finish(result: AuthorizationResult) {
    val token = result.accessToken
    if (token.isNullOrBlank() || !result.grantedScopes.containsAll(requested)) { fail("Google did not grant all the permissions this connector needs."); return }
    val promise = pending; pending = null; requested = emptyList()
    promise?.resolve(mapOf("accessToken" to token, "scopes" to result.grantedScopes))
  }
  private fun fail(message: String, cause: Throwable? = null) {
    val promise = pending; pending = null; requested = emptyList()
    promise?.reject("GOOGLE_AUTH", message, cause)
  }
  fun close() = fail("Google sign-in was interrupted. Try again.")
  companion object {
    private const val REQUEST = 58321
    @Suppress("DEPRECATION")
    fun info(context: Context): Map<String, Any> {
      val signatures = if (Build.VERSION.SDK_INT >= 28) context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_SIGNING_CERTIFICATES).signingInfo?.apkContentsSigners
        else context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_SIGNATURES).signatures
      val sha1 = signatures?.firstOrNull()?.toByteArray()?.let { MessageDigest.getInstance("SHA-1").digest(it).joinToString(":") { byte -> "%02X".format(byte.toInt() and 255) } } ?: "unavailable"
      return mapOf("packageName" to context.packageName, "sha1" to sha1, "playServicesAvailable" to (GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == 0))
    }
  }
}
