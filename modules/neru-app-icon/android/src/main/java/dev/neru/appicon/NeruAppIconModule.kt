package dev.neru.appicon

import android.content.ComponentName
import android.content.pm.PackageManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The launcher icon follows the accent theme. Android has no API to change an app's icon, so the manifest declares
 * one launcher activity-alias per theme (plugins/with-theme-icons.js) and this turns on the theme's alias and turns
 * the others off. `MainActivityMoss` is the one enabled in the manifest.
 */
class NeruAppIconModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NeruAppIcon")
    /** Shows `theme`'s icon; `themes` lists every alias. Returns true when the icon changed. */
    Function("setIcon") { theme: String, themes: List<String> ->
      val context = appContext.reactContext ?: return@Function false
      val pm = context.packageManager
      val alias = { name: String -> ComponentName(context.packageName, "${context.packageName}.MainActivity${name.replaceFirstChar { it.uppercase() }}") }
      val enabled = { name: String ->
        when (pm.getComponentEnabledSetting(alias(name))) {
          PackageManager.COMPONENT_ENABLED_STATE_ENABLED -> true
          PackageManager.COMPONENT_ENABLED_STATE_DEFAULT -> name == "moss"
          else -> false
        }
      }
      val target = if (theme in themes) theme else "moss"
      if (enabled(target) && themes.none { it != target && enabled(it) }) return@Function false
      // On first, then off: the app never has zero launcher entries.
      pm.setComponentEnabledSetting(alias(target), PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP)
      for (name in themes) if (name != target && enabled(name))
        pm.setComponentEnabledSetting(alias(name), PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP)
      true
    }
  }
}
