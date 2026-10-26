const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const { generateImageAsync } = require('@expo/image-utils');

// The launcher icon follows the accent theme: one activity-alias per theme in assets/images/themes (made by
// scripts/theme-icons.py), each with its own adaptive icon. Moss keeps Expo's ic_launcher. NeruAppIcon switches them.
const THEMES_DIR = 'assets/images/themes';
const DPI = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const cap = s => s[0].toUpperCase() + s.slice(1);
const themes = root => fs.readdirSync(path.join(root, THEMES_DIR)).filter(t => fs.existsSync(path.join(root, THEMES_DIR, t, 'android-icon-foreground.png'))).sort();

const withIcons = config => withDangerousMod(config, ['android', async config => {
  const root = config.modRequest.projectRoot;
  const res = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res');
  for (const theme of themes(root)) {
    // Same sizing as Expo's own adaptive foreground: 108dp per density.
    for (const [dpi, scale] of Object.entries(DPI)) {
      const size = 108 * scale;
      const { source } = await generateImageAsync({ projectRoot: root, cacheType: `theme-icon-${theme}` }, { src: path.join(root, THEMES_DIR, theme, 'android-icon-foreground.png'), width: size, height: size, resizeMode: 'cover', backgroundColor: 'transparent' });
      fs.mkdirSync(path.join(res, `mipmap-${dpi}`), { recursive: true });
      fs.writeFileSync(path.join(res, `mipmap-${dpi}`, `ic_launcher_${theme}_foreground.png`), source);
    }
    fs.mkdirSync(path.join(res, 'mipmap-anydpi-v26'), { recursive: true });
    fs.writeFileSync(path.join(res, 'mipmap-anydpi-v26', `ic_launcher_${theme}.xml`), `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/iconBackground"/>
    <foreground android:drawable="@mipmap/ic_launcher_${theme}_foreground"/>
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>
</adaptive-icon>
`);
  }
  return config;
}]);

const withAliases = config => withAndroidManifest(config, config => {
  const app = config.modResults.manifest.application[0];
  const main = app.activity.find(a => a.$['android:name'] === '.MainActivity');
  const isLauncher = f => f.category?.some(c => c.$['android:name'] === 'android.intent.category.LAUNCHER');
  // The aliases are the launcher entries now; MainActivity keeps its deep links.
  main['intent-filter'] = (main['intent-filter'] ?? []).filter(f => !isLauncher(f));
  const alias = (name, icon, round, enabled) => ({
    $: { 'android:name': `.MainActivity${cap(name)}`, 'android:targetActivity': '.MainActivity', 'android:enabled': String(enabled), 'android:exported': 'true', 'android:icon': icon, 'android:roundIcon': round, 'android:label': '@string/app_name' },
    'intent-filter': [{ action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }], category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }] }],
  });
  app['activity-alias'] = [
    ...(app['activity-alias'] ?? []).filter(a => !a.$['android:name'].startsWith('.MainActivity')),
    alias('moss', '@mipmap/ic_launcher', '@mipmap/ic_launcher_round', true),
    ...themes(config.modRequest.projectRoot).map(t => alias(t, `@mipmap/ic_launcher_${t}`, `@mipmap/ic_launcher_${t}`, false)),
  ];
  return config;
});

module.exports = config => withAliases(withIcons(config));
