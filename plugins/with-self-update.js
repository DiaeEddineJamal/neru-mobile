const { AndroidConfig } = require('expo/config-plugins');

// Neru updates itself from its GitHub releases (src/update.ts): it downloads the APK and opens Android's installer,
// which needs this permission. Android still asks the user once to allow installs from Neru.
module.exports = config => AndroidConfig.Permissions.withPermissions(config, ['android.permission.REQUEST_INSTALL_PACKAGES']);
