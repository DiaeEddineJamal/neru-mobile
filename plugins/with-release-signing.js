const { withAppBuildGradle } = require('expo/config-plugins');

// Release builds are signed with Neru's own key. The keystore and its passwords never enter the repo: they come
// from Gradle properties (NERU_RELEASE_STORE_FILE, NERU_RELEASE_KEY_ALIAS, NERU_RELEASE_STORE_PASSWORD,
// NERU_RELEASE_KEY_PASSWORD), set in the Gradle user home. Without them a release build stops instead of
// quietly falling back to the debug key, which Android would refuse as an update.
const release = `
        release {
            if (findProperty('NERU_RELEASE_STORE_FILE')) {
                storeFile file(findProperty('NERU_RELEASE_STORE_FILE'))
                storePassword findProperty('NERU_RELEASE_STORE_PASSWORD')
                keyAlias findProperty('NERU_RELEASE_KEY_ALIAS')
                keyPassword findProperty('NERU_RELEASE_KEY_PASSWORD')
            }
        }`;

module.exports = config => withAppBuildGradle(config, config => {
  let gradle = config.modResults.contents;
  if (!gradle.includes('NERU_RELEASE_STORE_FILE')) {
    gradle = gradle.replace(/(signingConfigs \{\s*debug \{[^}]*\})/, `$1${release}`);
    gradle = gradle.replace(/(release \{\s*(?:\/\/[^\n]*\n\s*)*)signingConfig signingConfigs\.debug/, '$1signingConfig signingConfigs.release');
    gradle = gradle.replace(/(buildTypes \{)/, `$1
        gradle.taskGraph.whenReady { graph ->
            if (graph.allTasks.any { it.name.toLowerCase().contains('release') } && !findProperty('NERU_RELEASE_STORE_FILE')) {
                throw new GradleException('Set NERU_RELEASE_STORE_FILE and the other NERU_RELEASE_* Gradle properties to sign a release.')
            }
        }`);
  }
  config.modResults.contents = gradle;
  return config;
});
