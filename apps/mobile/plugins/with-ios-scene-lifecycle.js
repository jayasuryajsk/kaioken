const { withInfoPlist, withXcodeProject, withDangerousMod } = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

const SCENE_DELEGATE_FILE = "SceneDelegate.swift";
const TEMPLATE_PATH = path.join(__dirname, "SceneDelegate.swift.template");

const OLD_LAUNCH_BLOCK = `    reactNativeDelegate = delegate
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
`;

const NEW_LAUNCH_BLOCK = `    reactNativeDelegate = delegate
    reactNativeFactory = factory
    self.launchOptions = launchOptions

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func startReactNative(in window: UIWindow, launchOptions: [UIApplication.LaunchOptionsKey: Any]?) {
    guard !reactNativeStarted, let factory = reactNativeFactory else { return }
    reactNativeStarted = true
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
  }
`;

const OLD_PROPERTIES = `  var reactNativeFactory: RCTReactNativeFactory?
`;

const NEW_PROPERTIES = `  var reactNativeFactory: RCTReactNativeFactory?
  var launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  private var reactNativeStarted = false
`;

function patchAppDelegate(source) {
  if (source.includes("func startReactNative(in window")) return source;
  if (!source.includes(OLD_LAUNCH_BLOCK) || !source.includes(OLD_PROPERTIES)) {
    throw new Error(
      "with-ios-scene-lifecycle: AppDelegate.swift changed shape; update the plugin to match the Expo template.",
    );
  }
  return source
    .replace(OLD_PROPERTIES, NEW_PROPERTIES)
    .replace(OLD_LAUNCH_BLOCK, NEW_LAUNCH_BLOCK);
}

function withSceneManifest(config) {
  return withInfoPlist(config, (mod) => {
    mod.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: "Default",
            UISceneDelegateClassName: "$(PRODUCT_MODULE_NAME).SceneDelegate",
          },
        ],
      },
    };
    return mod;
  });
}

function withSceneDelegateSources(config) {
  return withDangerousMod(config, [
    "ios",
    (mod) => {
      const projectName = mod.modRequest.projectName;
      const appDir = path.join(mod.modRequest.platformProjectRoot, projectName);
      fs.writeFileSync(
        path.join(appDir, SCENE_DELEGATE_FILE),
        fs.readFileSync(TEMPLATE_PATH, "utf8"),
      );
      const appDelegatePath = path.join(appDir, "AppDelegate.swift");
      fs.writeFileSync(
        appDelegatePath,
        patchAppDelegate(fs.readFileSync(appDelegatePath, "utf8")),
      );
      return mod;
    },
  ]);
}

function withSceneDelegateInProject(config) {
  return withXcodeProject(config, (mod) => {
    const project = mod.modResults;
    const projectName = mod.modRequest.projectName;
    const relativePath = `${projectName}/${SCENE_DELEGATE_FILE}`;
    if (project.hasFile(relativePath)) return mod;
    const groupKey = project.findPBXGroupKey({ name: projectName });
    project.addSourceFile(
      relativePath,
      { target: project.getFirstTarget().uuid },
      groupKey,
    );
    return mod;
  });
}

module.exports = function withIosSceneLifecycle(config) {
  return withSceneDelegateInProject(
    withSceneDelegateSources(withSceneManifest(config)),
  );
};
