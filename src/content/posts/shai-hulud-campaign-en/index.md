---
title: "npm Supply Chain Attacks: The Shai-Hulud Campaign"
published: 2026-09-22
description: "Exploring npm supply chain attacks, the propagation of the Shai-Hulud worm, and its campaign timeline through project data based on OpenSSF reports"
image: "/posts/shai-hulud-campaign/cover.png"
tags: ["npm", "Supply Chain Security", "Shai-Hulud", "CI/CD"]
category: "Security"
lang: "en"
urlSlug: "shai-hulud-campaign"
translationKey: "shai-hulud-campaign"
draft: false
---

![npm supply chain attacks: the Shai-Hulud campaign](/posts/shai-hulud-campaign/cover.png)

Hello! It has been quite a while since my last blog post.

For my university capstone project, I have been working on a pipeline to prevent npm supply chain attacks. My role is to analyze malicious package information collected from OpenSSF. During that analysis, I came across a particularly interesting campaign that I wanted to write about here.

## What is a supply chain attack?

A software supply chain attack targets the process through which software is developed or distributed, rather than directly attacking its users. Trusted libraries, packages, and update mechanisms become the attack path. Once a single component is compromised, the impact can spread to the many people and organizations that use it.

npm is a package management system widely used in the JavaScript and Node.js ecosystem.

Developers can easily add open-source packages from the npm registry to their projects using commands such as `npm install`. Each package may depend on several others, so a modern JavaScript project often includes many dependencies that its developers never installed directly.

This structure allows a supply chain attack on a single npm package to have a broad impact. If attackers take over a popular package's publishing account and inject malicious code into that package or its dependencies, the malicious code can reach downstream users and organizations.

The following articles discuss recent npm supply chain attacks:

- [Google Threat Intelligence: North Korean threat actor targets the Axios npm package](https://cloud.google.com/blog/topics/threat-intelligence/north-korea-threat-actor-targets-axios-npm-package/)
- [Related coverage from Boan News (Korean)](https://www.boannews.com/news/articleView.html?idxno=143826)

Our project began with the goal of detecting npm supply chain attacks in CI/CD pipelines to prevent this kind of damage.

## Malicious npm packages collected over the past year

> These statistics describe data collected and classified within our project using OpenSSF information. They are not official statistics for the entire npm ecosystem. Collection dates and classification criteria may differ from the package and version counts in public reports.

Our dataset contained roughly 150,000 malicious package records collected over the past year, from September 2025 to September 2026.

| Type | Count | Share | Characteristics |
| --- | --- | --- | --- |
| tea.xyz reward-farming spam | 140,728 | 89.5% | Malicious from creation (spam); automated, self-replicating publication |
| Unclassified (mostly suspected born-malicious cases) | 12,842 | 8.2% | Individual, small-scale cases suspected to have been malicious from creation |
| Brand impersonation | 609 | 0.4% | Malicious from creation |
| Typosquatting | 594 | 0.4% | Malicious from creation |
| Dependency confusion | 266 | 0.2% | Malicious from creation |
| Direct publication under threat actor identities | 65 | 0.04% | Malicious from creation |
| ClickFix-style phishing | 1 | 0.0% | Malicious from creation |
| **Compromised legitimate packages** | **2,091** | **1.3%** | **The focus of this study** |
| **Total** | **157,196** | **100%** | |

Because our project focuses on detecting supply chain attacks in CI/CD, we excluded packages that were malicious from the outset. Instead, we focused on **compromised packages**: packages that were originally legitimate but later became malicious.

We then classified those 2,091 compromised package records by campaign:

| Campaign | Count | Share | Compromise vector |
| --- | --- | --- | --- |
| Shai-Hulud: The Second Coming (2025-11) | 792 | 37.9% | Stolen npm accounts or tokens; a larger-scale worm |
| Mini Shai-Hulud (2026-04–05) | 526 | 25.2% | Takeover of the `atool` account (314 packages), Red Hat GitHub Actions OIDC abuse, and related incidents |
| Shai-Hulud: Here We Go Again (2026-08) | 444 | 21.2% | A worm beginning with the compromise of keyv/cacheable maintainer accounts |
| Original Shai-Hulud wave (2025-09) | 206 | 9.9% | The first self-replicating npm supply chain worm |
| CanisterWorm (TeamPCP, 2026-03) | 66 | 3.2% | TeamPCP activity using the ICP blockchain for command and control |
| IronWorm (2026-05) | 37 | 1.8% | A Rust information stealer using a native ELF binary rather than obfuscated JavaScript |
| Individual account or token theft (independent incidents) | 16 | 0.8% | Unrelated individual threat actors |
| SAP maintainer compromise | 4 | 0.2% | Compromise of SAP toolchain maintainer accounts |
| **Total** | **2,091** | **100%** | |

The original Shai-Hulud campaign and its variants accounted for the majority of these records.

I plan to examine the implementation in detail in a future post. For now, I will focus on the campaign's overall development and propagation mechanisms.

## The Shai-Hulud campaign timeline

![Shai-Hulud campaign timeline](/posts/shai-hulud-campaign/timeline.png)

> The original diagrams retain their Korean labels. Date corrections: the first wave occurred in **September 2025**, not September 2024; Mini Shai-Hulud belongs to **April–May 2026**, not August 2026. The August 2026 campaign is **Here We Go Again**, discussed below. Follow the dates in the text rather than those in the timeline image.

### 📍 The emergence of the Shai-Hulud worm — September 2025

![The original Shai-Hulud worm in September 2025](/posts/shai-hulud-campaign/original-wave.png)

*The “Sep 2024” label in this diagram should read “Sep 2025.”*

Shai-Hulud is a **self-propagating attack** discovered in the npm registry.

I use the word **worm** because it steals npm tokens from an infected environment and uses them to **copy itself into other npm packages** accessible with those tokens. Its ability to spread on its own is what makes it worm-like.

According to ReversingLabs, the first known compromised package was `rxnt-authentication@0.0.3`, published on September 14 at 17:58:50 UTC. The attack subsequently spread through popular packages, including `@ctrl/tinycolor`, which had roughly 2.2 million weekly downloads at the time.

#### How Shai-Hulud spreads

The key to Shai-Hulud's propagation is that stolen credentials are **reused for the next attack**.

In the malicious packages I analyzed, malicious JavaScript was introduced through one of the following paths:

```text
1. Added to a lifecycle script in package.json
   - preinstall
   - install
   - postinstall
2. Introduced through a dependency in package.json
3. Inserted directly into a file
```

**What is package.json?**

`package.json` is a configuration file that defines an npm package's name, version, dependencies, scripts, and other metadata.

For example, a package called `my-package` might have this structure:

```text
my-package/
├── package.json
├── index.js
└── test.js
```

Its `package.json` could look like this:

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

The fields mean:

- `name`: the package's name
- `version`: the package's version
- `scripts`: commands that can be run through npm
- `dependencies`: other packages required for the package to work

Running `npm install` in this project causes npm to read the dependencies in `package.json` and install the required Express package.

npm also supports lifecycle scripts that run at specific stages, such as installation and publication. Common examples are `preinstall`, `install`, and `postinstall`, which correspond to stages before, during, and after installation.

Whether lifecycle scripts execute depends on the package manager version and installation settings. They are a legitimate npm feature designed to automate tasks such as builds and initial setup. Attackers abused that **automatic execution** as the entry point for their payloads.

The original Shai-Hulud campaign used a `postinstall` script to execute `node bundle.js`. The payload used secret-scanning capabilities, including TruffleHog, to search for environment variables, GitHub tokens, npm tokens, and cloud credentials.

**What is secret scanning?**

Secret scanning automatically identifies credentials that may have been accidentally included in source code, configuration files, Git history, environment variables, or logs. Examples include:

```text
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

If a developer accidentally commits a credential to GitHub, perhaps in a source file or `.env` file, a secret scanner searches for strings that resemble credentials.

A basic detection method is pattern matching. For example, a GitHub classic personal access token uses the `ghp_` prefix, so that prefix followed by a string of the expected format can be flagged as a candidate.

TruffleHog goes a step further by attempting to validate detected credentials. For supported credential types, it can make non-destructive API requests; an AWS `GetCallerIdentity` request is one example. When scanning Git repositories, it can also inspect historical commits rather than only the current revision.

TruffleHog was designed to help developers prevent accidental credential exposure. What stood out to me was how the attackers repurposed this defensive tool for credential harvesting. Shai-Hulud used the scanner to obtain npm tokens and propagate itself.

After obtaining a valid npm token, the worm found other packages that the account could publish, inserted the malicious payload into them, and published new versions to the npm registry.

### 📍 Sha1-Hulud: The Second Coming — November 2025

![The Second Coming in November 2025](/posts/shai-hulud-campaign/second-coming.png)

About two months after the initial campaign subsided, another variant appeared.

Researchers called it Shai-Hulud 2.0, or **“Sha1-hulud: The Second Coming”** after the phrase used by the attackers.

The major changes were its **execution mechanism** and the addition of **persistence, stealth, and destructive behavior**.

#### A different execution mechanism

Where the original campaign used `postinstall`, this variant used `preinstall`. Packages also included two new payload files:

- `setup_bun.js`
- `bun_environment.js`

`setup_bun.js` checked whether the Bun runtime was present and acted as a loader for `bun_environment.js`, an obfuscated payload roughly 10 MB in size.

#### Persistence, stealth, and destruction

The main payload, `bun_environment.js`, ran as a background process. GitHub repositories created to hold stolen information carried the description **“Sha1-hulud: The Second Coming.”**

The variant added a **GitHub Actions workflow** that could execute in response to Discussion events. This provided **persistence**, allowing an access path to remain even after the malicious npm package was removed.

It also added functionality to **delete files in the user's home directory** if it could not obtain the required credentials or establish a working exfiltration path.

The Second Coming expanded the original campaign with stronger stealth, persistence, and sabotage capabilities.

### 📍 Mini Shai-Hulud — April–May 2026

![Mini Shai-Hulud in 2026](/posts/shai-hulud-campaign/mini-shai-hulud.png)

In 2026, attacks affected npm packages associated with the SAP development ecosystem.

One notable aspect of Mini Shai-Hulud was its use of the **CI/CD pipeline itself as an infection path**. Attackers used **CI cache poisoning** to introduce malicious code into legitimate release workflows and abused **OIDC-based npm publishing** to distribute malicious code through an apparently legitimate publisher.

The name came from the phrase **“A Mini Shai-Hulud has Appeared”**, which appeared in GitHub repositories created during propagation.

Socket reported that the full Mini Shai-Hulud campaign encompassed **502 packages and 1,055 versions**, with related activity in PyPI and Composer as well as npm.

Affected packages included major AntV packages such as `@antv/g2`, `@antv/g6`, and `@antv/x6`, alongside `echarts-for-react` and `timeago.js`. A key development was the use of package publishing infrastructure itself to insert malicious code into trusted release processes.

### 📍 Shai-Hulud: Here We Go Again — August 2026

Roughly three months later, another large Shai-Hulud-related attack occurred in August.

Here We Go Again retained the same worm-like structure while **expanding beyond npm into PyPI and CI/CD environments, broadening credential collection, and extending obfuscation and encrypted exfiltration capabilities**.

According to JFrog, the compromise began with the caching libraries `keyv` and `cacheable`, affecting more than 400 packages and more than 1,700 versions.

In the infected `keyv@6.0.0` package, a `preinstall` script launched the payload through this chain:

```text
setup.mjs -> Bun runtime -> math_init.js
```

`setup.mjs` checked whether Bun was installed, downloaded it if needed, and then executed the main malicious payload, `math_init.js`.

The payload collected credentials from local environments, CI/CD systems, cloud services, Kubernetes, and Vault. If it found an npm token, it located packages that could be modified with that token, inserted its own `setup.mjs` and `math_init.js`, incremented the patch version, and published the infected packages back to the npm registry.

GitHub repositories created during this campaign used the description **“Shai-Hulud: Here We Go Again”**.

---

## Reflections

This was a chronological overview of the Shai-Hulud campaign.

I found it interesting that the concept of a worm also applies to supply chain attacks. In particular, Shai-Hulud illustrates a self-propagating cycle: stolen credentials enable the compromise of more packages, which in turn expose new victims and credentials.

Shai-Hulud has continued to appear in recent reports and may return in other forms. Package publishers need to be careful about accidental credential exposure.

CI/CD is designed to automate development and deployment and make developers' work easier. This campaign is also a reminder that attackers can abuse that automation to distribute malicious code under the appearance of a legitimate release.

In the next post, I plan to examine actual package code collected through Datadog and take a closer look at how Shai-Hulud works internally.

Thanks for reading!

## References

- [ReversingLabs — FAQ: The Shai-hulud npm worm attack explained](https://www.reversinglabs.com/blog/faq-shai-hulud-explained)
- [JFrog — Major Shai Hulud campaign strikes npm again, affecting keyv and 400+ packages](https://research.jfrog.com/post/shai-hulud-is-back-august/)
- [Wiz — Shai-Hulud npm supply chain attack](https://www.wiz.io/blog/shai-hulud-npm-supply-chain-attack)
- [Socket — Mini Shai-Hulud hits the AntV ecosystem](https://socket.dev/blog/antv-packages-compromised)
- [Socket — Shai Hulud strikes again (v2)](https://socket.dev/blog/shai-hulud-strikes-again-v2)
