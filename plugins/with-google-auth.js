// Google sign-in for Gmail, Calendar and Drive connectors returns to the reversed client ID
// (com.googleusercontent.apps.<id>:/oauth2redirect). When app.json → extra.googleClientId is set, this registers
// that scheme so Android hands the redirect back to Neru.
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withGoogleAuth(config) {
  const clientId = config.extra?.googleClientId;
  if (!clientId) return config;
  const scheme = `com.googleusercontent.apps.${clientId.replace(/\.apps\.googleusercontent\.com$/, '')}`;
  return withAndroidManifest(config, mod => {
    const activity = mod.modResults.manifest.application?.[0]?.activity?.find(a => a.$['android:name'] === '.MainActivity');
    if (!activity) return mod;
    activity['intent-filter'] = activity['intent-filter'] ?? [];
    const exists = activity['intent-filter'].some(f => (f.data ?? []).some(d => d.$['android:scheme'] === scheme));
    if (!exists)
      activity['intent-filter'].push({
        action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
        category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }, { $: { 'android:name': 'android.intent.category.BROWSABLE' } }],
        data: [{ $: { 'android:scheme': scheme } }],
      });
    return mod;
  });
};
