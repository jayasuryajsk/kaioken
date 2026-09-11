#!/usr/bin/env node
/**
 * Rebrand an upstream `bb` checkout (github.com/get-bb/bb) into Kaioken.
 *
 * Kaioken is a personal fork. Instead of carrying a 6000-file rename diff
 * through every upstream merge, the rename is reproducible: reset `main` to
 * upstream, run this script, then re-apply the small set of Kaioken-only
 * commits. Run it from the repository root on a clean tree:
 *
 *   node scripts/rebrand-kaioken.mjs
 *
 * What it renames (product-owned identifiers):
 *   - package scopes: @bb/*              -> @kaioken/*
 *   - the plugin SDK: @get-bb/plugin-sdk -> @get-kaioken/plugin-sdk
 *     (its own scope: @kaioken/* means private workspace packages)
 *     (the upstream specifier is kept as the accepted legacy alias so
 *     marketplace plugins built against bb still load)
 *   - npm launcher:   bb-app              -> kaioken-app
 *   - CLI binary:     bb                  -> kaioken
 *   - env vars:       BB_*                -> KAIOKEN_*
 *   - data dirs:      ~/.bb, ~/.bb-dev, .bb/ -> ~/.kaioken, ~/.kaioken-dev, .kaioken/
 *   - identifiers:    BbPluginApi, bbThreadId, ... -> KaiokenPluginApi, kaiokenThreadId, ...
 *   - compounds:      bb-guide, bb-cli, --bb-shell-height, ... -> kaioken-*
 *   - URL scheme:     bb://                -> kaioken://
 *   - desktop update feed: github.com/get-bb/bb/releases -> this fork's releases
 *   - prose / labels: bb, BB              -> kaioken, Kaioken
 *   - file and directory names containing any of the above
 *
 * What it deliberately keeps (owned by upstream or by third parties):
 *   - the plugin manifest key `bb` and `engines.bb` / `engines.bbPluginSdk`
 *     (every published plugin declares them)
 *   - the plugin API parameter conventionally named `bb` (`plugin(bb) { bb.log... }`)
 *   - marketplace ids `bb-community` / `bb-official` and the labels
 *     "BB Community" / "BB Official" (they key the external marketplace repo
 *     and a database migration)
 *   - wire headers `x-bb-*` (the connect relay and existing plugins send them)
 *   - the `originator: "bb"` header (identifies the client to OpenAI's backend)
 *   - localStorage keys `bb.*`
 *   - URLs under getbb.app and github.com/get-bb/* (upstream services and docs)
 *   - `bbedit` (a third-party editor)
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const SELF = "scripts/rebrand-kaioken.mjs";
const FORK_REPO = "jayasuryajsk/kaioken";

const PROTECTED = [
  "get-bb/bb",
  "get-bb/",
  "get-bb\\/",
  "getbb.app",
  "x-bb-",
  "bb-community",
  "bb-official",
  "brsbl/bb-plugins",
  "bbPluginSdk",
  "bbedit",
  "BB Community",
  "BB Official",
  'originator: "bb"',
  '"originator", "bb"',
];

const DOTTED_EXTENSIONS =
  "mjs|cjs|ts|tsx|js|md|json|yml|yaml|db|png|svg|icns|zip|localhost|example";

// Keywords that precede an identifier in code; a bare `bb` after one of these
// is the plugin API parameter, not prose.
const CODE_KEYWORDS =
  /\b(?:return|void|typeof|await|yield|const|let|var|delete|new|throw|export|import|function)\s$/;

/**
 * Sites the generic rules cannot classify. The injected mobile bridge global is
 * renamed at runtime (`NATIVE_BRIDGE_GLOBAL = "kaioken"`), but its tests reach
 * it through property access, which the rules keep as the plugin API parameter.
 */
const FIXUPS = [
  // Marketplace plugins keep upstream's `bb-plugin-` package prefix, so the
  // derived plugin id must strip both prefixes.
  {
    file: "packages/domain/src/plugin-id.ts",
    from: /\.replace\(\/\^kaioken-plugin-\/, ""\)/g,
    to: '.replace(/^(?:kaioken-plugin-|bb-plugin-)/, "")',
  },
  {
    file: "packages/domain/src/plugin-id.ts",
    from: / \* `kaioken-plugin-linear` becomes `linear`; scoped names first drop the scope\.\n/g,
    to: " * `kaioken-plugin-linear` and `bb-plugin-linear` become `linear`; scoped names\n * first drop the scope. Marketplace plugins keep the upstream `bb-plugin-`\n * prefix, so both prefixes map to the same id.\n",
  },
  // The checkout-instance hash is derived from the fixture path, which the
  // rename changed.
  {
    file: "packages/config/test/config.test.ts",
    from: /src-kaioken-9039de53a76a/g,
    to: "src-kaioken-db812558aad7",
  },
  // Manifest key paths in assertions: ["bb", "branding", ...].
  {
    file: "packages/domain/test/plugin-icon.test.ts",
    from: /"kaioken",(\s*)"branding"/g,
    to: '"bb",$1"branding"',
  },
  // Fixture text where the product name is glued to other characters.
  {
    file: "apps/app/src/components/plugin/PluginComposerBanners.test.tsx",
    from: /rowBB row/g,
    to: "rowKaioken row",
  },
  {
    file: "apps/app/src/components/plugin/management/plugin-marketplace-author.test.ts",
    from: /name:BB\b/g,
    to: "name:Kaioken",
  },
  {
    file: "apps/app/src/components/tools/automation-overview.test.tsx",
    from: /Projects: bb;/g,
    to: "Projects: kaioken;",
  },
  // The injected mobile bridge global is renamed at runtime (NATIVE_BRIDGE_GLOBAL).
  {
    file: "plugins/push-notifications/client.ts",
    from: /window\.bb\b/g,
    to: "window.kaioken",
  },
  {
    file: "apps/server/test/public/public-thread-data.test.ts",
    from: /"window\.bb"/g,
    to: '"window.kaioken"',
  },
  // `[bb]` is a log tag in strings but an array literal here.
  {
    file: "apps/server/test/skills/skill-listing.test.ts",
    from: /skills: \[kaioken\]/g,
    to: "skills: [bb]",
  },
  {
    file: "packages/mobile-bridge/test/inject.test.ts",
    from: /fakeWindow\.bb\b/g,
    to: "fakeWindow.kaioken",
  },
  {
    file: "packages/mobile-bridge/test/inject.test.ts",
    from: /\bbb\?: \{ native/g,
    to: "kaioken?: { native",
  },
  {
    file: "apps/app/src/lib/native-shell/native-shell.test.ts",
    from: /\bbb: \{ native/g,
    to: "kaioken: { native",
  },
  {
    file: "apps/app/src/lib/native-shell/native-shell.test.ts",
    from: /\)\.bb\.native/g,
    to: ").kaioken.native",
  },
];

/** Files whose `"bb"` JSON keys are product-owned script/bin names, not the manifest key. */
const SCRIPT_KEY_FILES = new Set([
  "package.json",
  "apps/cli/package.json",
  "packages/bb-app/package.json",
  "packages/kaioken-app/package.json",
]);

const HASH_LINE =
  /\b(?:integrity|resolution|tarball):|sha(?:512|256|1)-[A-Za-z0-9+/=]{20,}/;

/** Rebrand text, leaving lines that carry integrity hashes untouched. */
export function rebrand(input, file = "") {
  if (HASH_LINE.test(input)) {
    return input
      .split("\n")
      .map((line) => (HASH_LINE.test(line) ? line : rebrandText(line, file)))
      .join("\n");
  }
  return rebrandText(input, file);
}

function rebrandText(input, file = "") {
  let s = input;
  // SDK specifier: current becomes @kaioken, the upstream name becomes the legacy alias.
  // The regex-escaped form (`@get-bb\/plugin-sdk` inside a RegExp literal) gets
  // the same treatment.
  s = s.replaceAll("@get-bb/plugin-sdk", "\u0000SDK\u0000");
  s = s.replaceAll("@get-bb\\/plugin-sdk", "\u0000SDKE\u0000");
  s = s.replaceAll("@bb/plugin-sdk", "@get-bb/plugin-sdk");
  s = s.replaceAll("@bb\\/plugin-sdk", "@get-bb\\/plugin-sdk");
  s = s.replaceAll("\u0000SDK\u0000", "@get-kaioken/plugin-sdk");
  s = s.replaceAll("\u0000SDKE\u0000", "@get-kaioken\\/plugin-sdk");
  // Desktop auto-update feed and release downloads point at this fork.
  s = s.replaceAll(
    "github.com/get-bb/bb/releases",
    `github.com/${FORK_REPO}/releases`,
  );

  if (SCRIPT_KEY_FILES.has(file)) {
    s = s.replace(/"bb(:dev)?"(\s*):/g, '"kaioken$1"$2:');
  }

  PROTECTED.forEach((token, i) => {
    s = s.replaceAll(token, `\u0000P${i}\u0000`);
  });

  s = s.replaceAll("@bb/", "@kaioken/");
  s = s.replace(/@bb(?![\w/-])/g, "@kaioken"); // bare scope literal: "@bb", /^@bb(?:\/|$)/
  s = s.replaceAll("@bb\\/", "@kaioken\\/"); // regex-escaped form, e.g. /^@bb\//
  s = s.replace(/(?<![\w$])BB_(?=[A-Z0-9*"'`])/g, "KAIOKEN_");
  s = s.replace(/_BB_(?=[A-Z0-9])/g, "_KAIOKEN_");
  s = s.replace(/(?<![\w$])Bb(?=[A-Z][a-z])/g, "Kaioken");
  s = s.replace(/(?<![\w$])bb(?=[A-Z][a-z])/g, "kaioken");
  s = s.replace(/(?<![\w-])\.bb-dev(?!\w)/g, ".kaioken-dev");
  s = s.replace(/(?<![\w\-)\]])\.bb(?=$|["'`/\s\\$%])/gm, ".kaioken"); // dir, not `x.bb`
  s = s.replaceAll("%2F.bb%2F", "%2F.kaioken%2F");
  s = s.replace(/dev\.bb\.desktop/g, "dev.kaioken.desktop");
  s = s.replace(
    new RegExp(`(?<![\\w@$])bb\\.(?=(?:${DOTTED_EXTENSIONS})(?!\\w))`, "g"),
    "kaioken.",
  );
  s = s.replace(
    new RegExp(`(?<![\\w@$])bb\\\\\\.(?=(?:${DOTTED_EXTENSIONS})(?!\\w))`, "g"),
    "kaioken\\.",
  ); // regex-escaped form: /kaioken\.db/
  s = s.replace(/(?<![\w@.$])bb:\/\//g, "kaioken://");
  s = s.replace(/(?<![\w@.$])bb:dev(?!\w)/g, "kaioken:dev");
  s = s.replace(/(?<![\w@$])bb-(?=[a-z0-9])/g, "kaioken-"); // includes CSS selectors like `.kaioken-x`

  // Bare word. Kept when it is the plugin API parameter or an object key.
  s = s.replace(/(?<![\w@.$:])bb(?!\w)/g, (match, offset, str) => {
    const before = str.slice(Math.max(0, offset - 40), offset);
    const after = str.slice(offset + 2, offset + 40);
    if (/["']$/.test(before) && /^["']:/.test(after)) return match; // "bb": key
    if (/^(\\?\.[\w?$]|\?[.:])/.test(after)) return match; // bb.log, bb?.app, bb?: key
    if (/^\s*[:=;,)}]/.test(after)) {
      // Prose reads "... inside bb, ..." (a word, a space, then bb). Code reads
      // "(bb, ctx)", "{ bb }", "return bb;", "  bb,".
      const prose = /\w\s$/.test(before) && !CODE_KEYWORDS.test(before);
      return prose ? "kaioken" : match;
    }
    return "kaioken";
  });
  s = s.replace(/(?<![\w@.$:-])BB(?![\w-])/g, "Kaioken");

  PROTECTED.forEach((token, i) => {
    s = s.replaceAll(`\u0000P${i}\u0000`, token);
  });
  for (const fixup of FIXUPS) {
    if (fixup.file === file) s = s.replace(fixup.from, fixup.to);
  }
  return s;
}

function pruneEmptyDirectories(relativeDir) {
  let dir = relativeDir;
  while (dir && dir !== ".") {
    const abs = resolve(root, dir);
    if (!existsSync(abs) || readdirSync(abs).length > 0) return;
    rmdirSync(abs);
    dir = dirname(dir);
  }
}

function isBinary(buffer) {
  return buffer.subarray(0, 8000).includes(0);
}

function main() {
  const files = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    maxBuffer: 1 << 28,
  })
    .toString("utf8")
    .split("\0")
    .filter((f) => f.length > 0 && f !== SELF);

  let renamed = 0;
  let edited = 0;
  for (const file of files) {
    const target = rebrand(file);
    if (target !== file) {
      mkdirSync(resolve(root, dirname(target)), { recursive: true });
      if (existsSync(resolve(root, target))) {
        throw new Error(`rename collision: ${file} -> ${target}`);
      }
      renameSync(resolve(root, file), resolve(root, target));
      renamed += 1;
      pruneEmptyDirectories(dirname(file));
    }
    const abs = resolve(root, target);
    const buffer = readFileSync(abs);
    if (isBinary(buffer)) continue;
    const before = buffer.toString("utf8");
    const after = rebrand(before, file);
    if (after !== before) {
      writeFileSync(abs, after);
      edited += 1;
    }
  }
  // Fixups splice code in by regex; let prettier settle the formatting so the
  // result matches a hand-formatted checkout byte for byte.
  const fixupFiles = [...new Set(FIXUPS.map((fixup) => fixup.file))].filter(
    (f) => existsSync(resolve(root, f)),
  );
  try {
    execFileSync(
      "pnpm",
      ["exec", "prettier", "--write", "--log-level", "warn", ...fixupFiles],
      { cwd: root, stdio: "inherit" },
    );
  } catch {
    console.warn(
      `prettier is not available here; run it on: ${fixupFiles.join(" ")}`,
    );
  }
  console.log(`renamed ${renamed} paths, edited ${edited} files`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(root, SELF)) {
  main();
}
