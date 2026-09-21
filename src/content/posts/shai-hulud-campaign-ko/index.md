---
title: "npm 공급망 공격: Shai-Hulud 캠페인"
published: 2026-09-22
description: "OpenSSF 기반 프로젝트 데이터로 살펴본 npm 공급망 공격과 Shai-Hulud 웜의 전파 방식 및 캠페인 타임라인"
image: "/posts/shai-hulud-campaign/cover.png"
tags: ["npm", "Supply Chain Security", "Shai-Hulud", "CI/CD"]
category: "Security"
lang: "ko"
urlSlug: "shai-hulud-campaign"
translationKey: "shai-hulud-campaign"
draft: false
---

안녕하세요. 굉장히 오랜만에 블로그 포스팅입니다!

요즘 학교 캡스톤 프로젝트로 npm 공급망 공격을 막기 위한 파이프라인을 만들고 있는데요, 저는 OpenSSF에서 수집한 악성 패키지 정보를 가지고 데이터를 분석하는 역할을 맡았습니다. 분석 도중에 좀 흥미로운 캠페인이 있어서, 블로그 포스팅 주제로 가져왔습니다.

## 공급망 공격이란?

우선 소프트웨어 공급망 공격은 공격자가 사용자를 직접 공격하는 대신, 소프트웨어가 개발/배포되는 과정에 개입하여 공격하는 방식을 말합니다. 개발자가 신뢰하는 라이브러리나 패키지, 업데이트 과정 등이 공격 경로가 되기 때문에 하나의 구성요소가 감염되면 이를 사용하는 여러 사용자와 기업으로 피해가 확산될 수 있습니다.

다양한 패키지중에서도 npm은 JavaScript/Node.js 생태계에 널리 사용되는 패키지 관리 시스템입니다.

개발자는 npm Registry에 공개된 수많은 오픈소스 패키지를 npm install 등의 명령으로 손쉽게 프로젝트에 추가할 수 있고, 하나의 패키지가 다시 여러 패키지에 의존하는 구조를 가지고 있어 현대 JavaScript 프로젝트는 직접 설치하지 않은 패키지까지 포함해 많은 의존성을 가지고 있습니다.

이러한 특성 때문에, npm 생태계는 단일 패키지의 공급망 공격이 광범위한 피해로 이어질 수 있습니다. 공격자가 널리 사용되는 패키지의 배포 계정을 탈취하여, 해당 패키지나 그 의존성에 악성 패키지를 삽입하면 이를 사용하는 모든 사용자 또는 기업에게 악성코드가 전달될 수 있기 때문입니다.

최신 npm 공급망 공격 관련 정보는 아래 블로그 및 기사에서 찾아보실 수 있습니다.

https://cloud.google.com/blog/topics/threat-intelligence/north-korea-threat-actor-targets-axios-npm-package/?e=48754805&hl=en

https://www.boannews.com/news/articleView.html?idxno=143826

저희 프로젝트는 이러한 피해를 막고자, CI/CD 과정에서 발생하는 npm 공급망 공격 탐지를 목적으로 시작하였습니다.

## 최근 1년 악성 npm 패키지의 종류

> 아래 통계는 OpenSSF 정보를 바탕으로 프로젝트에서 수집·분류한 데이터의 집계입니다. 전체 npm 생태계의 공식 통계가 아니며, 공개 보고서의 패키지·버전 집계와는 수집 시점 및 분류 기준이 다를 수 있습니다.

OpenSSF 정보 기준으로, 최근 1년(2025.9~2026.9)동안 수집된 악성패키지는 약 15만건 정도였습니다.

| 유형 | 건수 | 비율 | 성격 |
| --- | --- | --- | --- |
| tea.xyz 리워드 파밍 스팸 | 140,728 | 89.5% | 처음부터 악성(spam), 자기복제 자동발행 |
| 미분류 (대부분 born-malicious 추정) | 12,842 | 8.2% | 처음부터 악성으로 추정되는 개별 소규모 케이스 |
| 브랜드 사칭(impersonation) | 609 | 0.4% | 처음부터 악성 |
| 타이포스쿼팅(typosquatting) | 594 | 0.4% | 처음부터 악성 |
| Dependency confusion | 266 | 0.2% | 처음부터 악성 |
| 위협행위자 명의 직접 발행 | 65 | 0.04% | 처음부터 악성 |
| ClickFix 스타일 피싱 | 1 | 0.0% | 처음부터 악성 |
| **정상 패키지 침해(Compromised)** | **2,091** | **1.3%** | **본 연구의 분석 대상** |
| **합계** | **157,196** | **100%** |  |

본 프로젝트는 CI/CD 과정에서 발생하는 공급망 공격을 탐지하는 것이 목적이었으므로, 처음부터 악성인 케이스는 제외하고 compromised된 패키지(중간에 악성으로 변경된)를 본 연구의 분석 대상으로 삼았습니다.

이 2091건의 compromised package에 대해서도 통계를 낸 결과,

| 캠페인 | 건수 | 비율 | 침해 벡터 |
| --- | --- | --- | --- |
| Shai-Hulud: The Second Coming (2025-11) | 792 | 37.9% | npm 계정/토큰 탈취, 대형화된 웜 |
| Mini Shai-Hulud (2026-04~05) | 526 | 25.2% | `atool` 계정 탈취(314개 패키지) + Red Hat GitHub Actions OIDC 탈취 등 |
| Shai-Hulud: Here We Go Again (2026-08) | 444 | 21.2% | keyv/cacheable 메인테이너 계정 탈취로 시작된 웜 |
| Shai-Hulud 원조 웨이브 (2025-09) | 206 | 9.9% | 최초의 npm 자기복제 공급망 웜 |
| CanisterWorm (TeamPCP, 2026-03) | 66 | 3.2% | TeamPCP 위협행위자, ICP 블록체인 C2 활용 |
| IronWorm (2026-05) | 37 | 1.8% | Rust 인포스틸러, 네이티브 ELF 바이너리 (JS 난독화 아님) |
| 개별 계정/토큰 탈취 (독립 사건) | 16 | 0.8% | 서로 무관한 개별 위협행위자들 |
| SAP maintainer compromise | 4 | 0.2% | SAP 툴체인 메인테이너 계정 탈취 |
| **합계** | **2,091** | 100% |  |

이와 같이 대다수의 건수가 Shai-Hulud의 원조 및 그 변종인 것을 확인할 수 있었습니다.

Shai-Hulud의 구체적인 동작 방식은 다음 포스팅에서 자세히 살펴보고, 이번 포스팅에서는 이 캠페인의 큰 흐름과 전파방식을 중심으로 정리해보겠습니다.

## Shai-Hulud 캠페인의 타임라인

![Shai-Hulud 캠페인 타임라인](/posts/shai-hulud-campaign/timeline.png?v=2)

### 📍Shai-Hulud Worm의 등장 - 2025년 9월

![2025년 9월 최초 Shai-Hulud 웜](/posts/shai-hulud-campaign/original-wave.png?v=2)

Shai-Hulud는 npm registry에서 발견된 **자기전파형(Self-propagating) 공격**입니다.

소제목에 **Worm**이라는 단어를 썼는데, 이는 감염된 환경에서 npm 토큰을 탈취하여 해당 토큰으로 접근할 수 있는 다른 npm 패키지에 **자기 자신을 복제하여 전파하기** 때문입니다. 즉, 스스로 확산한다는 점에서 Worm의 특징을 가지고 있습니다.

ReversingLabs의 포스팅에 따르면, 가장 최초의 손상된 패키지는 9월 14일 17:58:50 UTC에 rxnt-authentication 0.0.3인것으로 확인되었습니다. 이후 주당 약 220만 회 다운로드되던 @ctrl/tinycolor패키지와 더불어 다른 인기 있는 패키지들이 잇따라 감염됨에 따라 크게 전파된 것으로 파악됩니다.

#### Shai-Hulud의 전파방식

Shai-Hulud의 전파방식의 핵심은, 탈취한 credential을 **다음 공격을 위해 재사용**한다는 것입니다.

악성패키지를 직접 분석해본 결과, 감염된 npm 패키지는 아래의 방식중 하나로 악성 js 파일을 실행시킵니다.

```
1. package.json파일의 lifecycle에 추가
    1. preinstall
    2. install
    3. postinstall
2. package.json파일의 dependency에 추가
3. file에 직접 추가
```

- package.json이란?

    package.json은 npm 패키지의 이름, 버전, 의존성, 실행 스크립트 등 패키지에 대한 정보를 정의하는 설정 파일입니다.

    예를 들어 `my-package` 라는 패키지가 있다면

    ```
    my-package/
    ├── package.json
    ├── index.js
    └── test.js
    ```

    이렇게 구성될 것이고, package.json은

    ```json
    {
      "name": "my-package",
      "version": "1.0.0",

      "scripts": {
        "test": "node test.js"
      },

      "dependencies": {
        "express": "^5.0.0"
      }
    }
    ```

    이렇게 작성할 수 있습니다.

    각 항목은 다음과 같은 의미를 가집니다.

    - `name`: 패키지의 이름
    - `version`: 패키지의 버전
    - `scripts`: npm을 통해 실행할 명령
    - `dependencies`: 해당 패키지가 동작하기 위해 필요한 다른 패키지

    예를 들어 위 프로젝트에서 `npm install` 을 실행하면 npm은 package.json의 dependencies를 확인해 필요한 express 패키지를 설치합니다.

    npm에는 패키지의 설치, 배포 등 특정 시점에 자동으로 실행되는 Lifecycle Script가 존재하는데, 대표적으로 아래 세가지가 있습니다.

    - preinstall
    - install
    - postinstall

    각각 이름 그대로, 패키지 설치 전, 설치 과정, 설치 후에 실행되는 스크립트라는 의미입니다.

    Lifecycle Script의 실행 여부는 패키지 관리자 버전과 설치 설정에 따라 달라집니다. Lifecycle Script 자체는 패키지 설치 과정에서 빌드나 초기 설정 등을 자동화하기 위해 제공되는 정상적인 npm 기능입니다.

    하지만 공격자는 이 Lifecycle이 **자동 실행**된다는 점을 악용하여 악성 페이로드의 시작 지점으로 활용했습니다.


최초 Shai-Hulud는 postinstall 스크립트를 이용해 node bundle.js 를 실행시켰고, bundle.js는 TruffleHog와 같은 secret scanning 기능을 이용해 개발자의 환경 변수, GitHub token, npm token, cloud credential 등을 탐색했습니다.

- secret scanning 기능이란

    소스코드, 설정 파일, git 기록, 환경 변수, 로그 등에 실수로 포함된 credential을 자동으로 찾아내는 기술입니다.

    여기서 말하는 credential이란 아래와 같은 것들을 포함합니다.

    ```
    AWS Access Key / Secret Key
    GitHub Personal Access Token
    npm Access Token
    Google Cloud Credential
    Stripe API Key
    Slack Token
    Database Password
    SSH Private Key
    JWT
    ```

    이러한 정보를 개발자가 실수로 github에 코드, 또는 .env에 올리면 secret scanner는 파일들을 돌아다니며 이런 credential로 보이는 문자열들을 자동으로 탐지합니다.

    탐지하는 방법은 기본적으로 패턴 매칭인데, 예를 들면 GitHub Token은 보통 “ghp_”라는 prefix를 가지므로 `“ghp_” + 일정 길이의 문자` 를 GitHub Token 후보로 넣습니다.

    scanner 중에서도 TruffleHog는 여기서 한단계 더 나아가, 후보에 있는 키를 validation하여 진짜 credential인지 확인합니다. 이 때 비파괴 API 요청을 이용하는데, AWS의 경우 `GetCallerIdentity` 같은 API호출을 통해 발견한 secret이 진짜 credential인지 검사합니다.

    Git의 경우에는 history를 확인하여 현재 commit 뿐만아니라 과거 commit까지 secret을 스캔합니다.

    TruffleHog의 원래 목적은 개발자가 실수로 credential을 노출하는 것을 방어하고자 만들어졌지만, 공격자는 이것을 credential harvesting 도구로 사용했다는 점이 인상적이었습니다. Shai-Hulud는 이 TruffleHog secret scanner를 이용해 npm token을 탈취해 자기자신을 전파했습니다.


이후 유효한 npm token을 확보하면, 해당 계정이 Publish 권한을 가지고 있는 다른 npm 패키지를 찾아 똑같이 악성 payload를 삽입하고, 새로운 버전을 npm registry에 배포했습니다.

### 📍Sha1-hulud: The Second Coming - 2025년 11월

![2025년 11월 The Second Coming](/posts/shai-hulud-campaign/second-coming.png)

최초 캠페인이 진정된 이후, 약 두달 뒤에 새로운 변종이 등장했습니다.

연구자들은 이를 Shai-Hulud 2.0 또는 공격자가 사용한 문구를 따라 **“Sha1-hulud: The Second Coming”**이라고 불렀습니다.

해당 변종의 가장 큰 변화는 **악성코드의 실행 방식**과 **지속성, 은닉, 파괴 기능을 추가한 점**이었습니다.

#### 변화된 실행 방식

최초 캠페인이 postinstall을 이용했다면 변종에선 preinstall을 이용했습니다. 또한 패키지에는 아래의 새로운 payload가 포함되었습니다.

- setup_bun.js
- bun_environment.js

setup_bun.js 는 먼저 시스템에 bun runtime이 존재하는지 확인하고, 약 10MB 규모로 난독화된 bun_environment.js 를 실행시키는 로더 역할을 했습니다.

#### 지속성 확보와 은닉, 그리고 파괴

실제 악성 페이로드인 bun_environment.js 는 background process로 실행되었고, 탈취한 정보를 저장하기 위해 생성한 GitHub repository에 **“Sha1-hulud: The Second Coming.”**이라는 description을 남겼습니다.

변종은 **GitHub Actions에 workflow를 추가**하여, Discussion 이벤트가 발생하면 자동 실행되도록 했습니다. 즉 악성 npm 패키지를 삭제하더라도 접근 경로가 유지되도록 하여 **지속성을 확보**하였습니다.

또한 credential을 확보하지 못하거나 정상적인 exfiltration channel을 만들지 못할 경우, 사용자의 **home directory에 있는 파일을 삭제하는 기능**도 추가되었습니다.

Second Coming은 최초 버전에서 **stealth, persistence, sabotage 기능을 추가한 더 강화된 버전**이었습니다.

### 📍Mini Shai-Hulud - 2026년 4-5월

![2026년 Mini Shai-Hulud](/posts/shai-hulud-campaign/mini-shai-hulud.png)

2026년에는 SAP 개발 생태계와 관련된 npm 패키지들이 공격받았습니다.

Mini Shai-Hulud에선 **CI/CD pipeline 자체를 감염 경로**로 이용했다는 것이 주목할 부분인데, 공격자는 **CI cache poisoning**을 이용해 정상적인 release workflow에 악성코드를 주입하고, npm의 **OIDC 기반 publishing 과정**을 악용해 정상적인 배포자처럼 악성코드를 배포했습니다.

공격자가 전파를 위해 생성한 GitHub repository에 **“A Mini Shai-Hulud has Appeared”**라는 문구를 사용하면서 Mini Shai-Hulud라는 이름이 붙게 되었습니다.

Socket은 전체 Mini Shai-Hulud 캠페인의 규모가 **502개 package, 1,055개 version**에 달했으며 npm뿐만 아니라 일부 PyPI 및 Composer package에서도 관련 활동이 확인되었다고 보고했습니다.

@antv/g2, @antv/g6, @antv/x6 등 AntV의 주요 패키지뿐만 아니라 echarts-for-react, timeago.js 등의 패키지도 영향을 받았으며, package publishing infra 자체를 이용해 신뢰할 수 있는 정상 배포 과정에 악성코드를 삽입하는 형태로 발전한 점이 주요 특징점입니다.

### 📍Shai-Hulud: Here We Go Again - 2026년 8월

약 3개월이 흐른 8월에도 다시 한번 대규모 Shai-Hulud 계열 공격이 발생했습니다.

Here We Go Again은 동일한 웜 구조를 유지하면서, **공격 대상을 npm에서 PyPI와 CI/CD 환경까지 넓히고, credential 수집 범위와 난독화·암호화된 정보 유출 등의 기능을 크게 확장**한 변종입니다.

JFrog에 따르면 caching library인 keyv와 cacheable에서 시작되었으며, 400개 이상의 패키지와 1700개 이상의 version이 영향을 받았습니다.

감염된 keyv@6.0.0에선 preinstall script를 통해 아래와 같이 페이로드를 실행시켰습니다.

```
setup.mjs -> Bun runtime -> math_init.js
```

setup.mjs 에선 시스템에 bun이 있는지 확인하고, 없다면 다운로드 한뒤, 실제 악성 payload인 math_init.js 를 실행시켰습니다.

악성 페이로드는 마찬가지로 local environment, CI/CD 환경, cloud, Kubernetes, Vault 등에서 credential을 수집한 후, npm token을 발견하면 해당 token으로 수정할 수 있는 모든 package를 찾아 자신의 setup.mjs와 math_init.js를 삽입한 뒤 patch version을 증가시켜 npm Registry에 다시 publish합니다.

이 때 공격자가 생성한 GitHub repository에는 **“Shai-Hulud: Here We Go Again”**이라는 description이 사용되었습니다.

---

## 느낀점

이렇게 Shai-Hulud 캠페인을 시간 경위로 조사해보았습니다.

공급망 공격에서도 worm라는 개념이 있다는 것이 흥미로웠습니다. 특히 Shai-Hulud가 탈취한 credential을 이용해 다른 패키지를 감염시키고, 이를 통해 다시 새로운 피해자로 확산되는 자기 전파 구조를 확인할 수 있었습니다.

Shai-Hulud는 최근까지도 관찰된 현재진행형 캠페인입니다. 이후 또 다른 변종으로 전파될 수 있으므로, 패키지 배포자들은 자신들의 credential을 실수로 유출하지 않도록 유의해야합니다.

또한 CI/CD라는 과정은 개발과 배포 과정을 자동화하고 개발자들의 편의성을 높이기 위한 시스템이지만, 공격자 역시 이를 악용해 정상적인 배포로 위장하여 악성코드를 유포할 수 있다는 점을 기억해야합니다.

다음 포스팅에서는 datadog를 통해 수집한 실제 패키지 코드를 뜯어서, Shai-Hulud의 디테일한 동작 분석을 해보겠습니다.

읽어주셔서 감사합니다!

## Reference

https://www.reversinglabs.com/blog/faq-shai-hulud-explained

[https://research.jfrog.com/post/shai-hulud-is-back-august/](https://research.jfrog.com/post/shai-hulud-is-back-august/)

[https://www.wiz.io/blog/shai-hulud-npm-supply-chain-attack](https://www.wiz.io/blog/shai-hulud-npm-supply-chain-attack)

[https://socket.dev/blog/antv-packages-compromised](https://socket.dev/blog/antv-packages-compromised)

[https://socket.dev/blog/shai-hulud-strikes-again-v2](https://socket.dev/blog/shai-hulud-strikes-again-v2)
