const appName = 'Lang Travel';

module.exports = {
  expo: {
    name: appName,
    slug: 'lang-travel',
    version: '0.1.0',
    orientation: 'portrait',
    scheme: 'langtravel',
    userInterfaceStyle: 'light',
    jsEngine: 'hermes',
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.langtravel.mobile',
      infoPlist: {
        NSLocationWhenInUseUsageDescription:
          'Lang Travel 需要访问当前位置，用于展示附近点位和生成路线。',
      },
    },
    android: {
      package: 'com.langtravel.mobile',
      adaptiveIcon: {
        backgroundColor: '#f7fbff',
      },
    },
    plugins: [
      [
        'expo-gaode-map',
        {
          iosKey: process.env.AMAP_IOS_KEY || '',
          androidKey: process.env.AMAP_ANDROID_KEY || '',
          enableLocation: true,
          enableBackgroundLocation: false,
          locationDescription: 'Lang Travel 需要访问当前位置，用于展示附近点位和生成路线。',
        },
      ],
      [
        'expo-location',
        {
          locationWhenInUsePermission:
            'Lang Travel 需要访问当前位置，用于展示附近点位和生成路线。',
        },
      ],
    ],
    extra: {
      apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL || '',
    },
  },
};
