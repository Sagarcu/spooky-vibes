const { withAppBuildGradle } = require('expo/config-plugins');

module.exports = function withWindowsCmakePaths(config) {
  return withAppBuildGradle(config, config => {
    if (config.modResults.language !== 'groovy') {
      throw new Error('The Windows CMake path configuration requires a Groovy app build.gradle.');
    }
    const marker = '// Spooky Vibes: keep Ninja object paths within the Windows filename limit.';
    if (!config.modResults.contents.includes(marker)) {
      config.modResults.contents += `
${marker}
if (System.getProperty("os.name").toLowerCase().contains("windows")) {
    android.defaultConfig.externalNativeBuild.cmake.arguments "-DCMAKE_OBJECT_PATH_MAX=240"
}
`;
    }
    return config;
  });
};
