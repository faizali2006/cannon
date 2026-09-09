const os = require('node:os');

const nativeUserInfo = os.userInfo;
os.userInfo = function safeUserInfo(options) {
  try {
    return nativeUserInfo(options);
  } catch (_) {
    return {
      uid: -1,
      gid: -1,
      username: process.env.USERNAME || 'android-builder',
      homedir: process.env.USERPROFILE || process.cwd(),
      shell: null
    };
  }
};
