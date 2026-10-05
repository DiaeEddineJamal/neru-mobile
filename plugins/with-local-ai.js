const { withProjectBuildGradle } = require('expo/config-plugins');

// Kotlin 2.3.20 reads LiteRT-LM 2.4 metadata and has an Expo Pika compiler plugin.
module.exports = config => withProjectBuildGradle(config, config => {
  config.modResults.contents = config.modResults.contents.replace("classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')", 'classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:${findProperty(\'android.kotlinVersion\') ?: \'2.3.20\'}")');
  return config;
});
