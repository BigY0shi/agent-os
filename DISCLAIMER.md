# Disclaimer and Assumption of Risk

Agent OS is software published by Launchworks. This document describes what it does, what it does not promise, and where responsibility sits. Read it before running the software, not after.

**This is not legal advice, and it is not a substitute for a reviewed agreement.** If you are deploying Agent OS in a commercial setting, or on behalf of anyone other than yourself, get it looked at by a lawyer.

## What you are actually running

Most disclaimers are vague because the software is ordinary. This one is specific because Agent OS is not. By running it you are, on purpose, giving software the ability to:

- **Execute commands on your machine.** Agent OS shells out to CLI agents (Claude Code, Codex, Cursor, Hermes, and others) using your own installed binaries and your own logged-in subscriptions. Those agents can read, write, and delete files, and can run programs.
- **Act as you on the internet.** Browser agents drive a real Chromium session. Where you have signed that browser into an account, an agent operating it can do what you could do in that account. Domain allowlists narrow this. They are a guardrail, not a security boundary.
- **Send email.** Configured mail integrations send real messages to real people from an address you control.
- **Spend money.** Agents consume paid API credits, metered CLI subscriptions, and any third-party service you connect. An agent in a loop can spend more than you expected before you notice.
- **Listen on your network.** The production launcher binds every interface, not just localhost. A password gate stands in front of it and refuses all requests when no password is set, but anything reachable on your network can reach the login.
- **Store credentials on disk.** Two different ways, and the distinction matters. Integration secrets (OAuth tokens and connector configs) are sealed with AES-256-GCM in the database. Everything else, including the AgentMail, newsletter, and outreach API keys, sits in plaintext under `~/.agentic-os/`. Browser session cookies live in Chromium profile directories, protected by your operating system's file permissions.

  The encryption is real but narrow: the key that unseals it (`~/.agentic-os/agentos.key`, 32 bytes) is stored beside the data it protects. That defends against someone who obtains the database file alone. It does not defend against anyone with read access to your home directory, and it is not designed to.

Agent OS contains a credential containment model that stops one agent from using another principal's browser profile. That containment governs **tool calls**. It does not sandbox arbitrary code. Anything able to run code in the server process can read those directories directly.

## No warranty

The software is provided "as is", without warranty of any kind, express or implied, including any implied warranty of merchantability, fitness for a particular purpose, or non-infringement.

Launchworks does not warrant that the software is free of defects, that it will operate without interruption, that its output is accurate or fit for any purpose, or that any agent will behave as intended. Autonomous systems act on inference. They will sometimes be confidently wrong.

## Your responsibility

You are solely responsible for:

- Every action taken by any agent you configure, trigger, schedule, or allow to run, including actions you did not specifically anticipate.
- Every credential, key, token, and account you connect, and any cost, suspension, rate limit, or term-of-service violation arising from their use.
- Reviewing anything an agent produces before it reaches a customer, a public channel, a repository, or a payment.
- Deciding which approval gates to keep. Agent OS ships gates on destructive and outward-facing actions. Disabling them is a choice you own.
- Securing the machine and the network you run it on, including setting a password before exposing the interface.
- Complying with the law and with the terms of every third-party service you connect, including where automated access is restricted.

## Indemnification

You agree to indemnify, defend, and hold harmless Launchworks and its owner from any claim, demand, loss, liability, cost, or expense, including reasonable legal fees, arising out of or related to:

1. your use of the software,
2. any action taken by an agent you ran, configured, or permitted to run,
3. any content the software sent, published, or transmitted on your instruction or on an agent's initiative,
4. your breach of a third party's terms, rights, or applicable law, and
5. any credential, account, or data you connected to it.

This applies whether the action was intended, mistaken, or the result of a defect in the software.

## Limitation of liability

To the maximum extent permitted by law, Launchworks is not liable for any indirect, incidental, special, consequential, punitive, or exemplary damages, or for lost profits, lost revenue, lost data, business interruption, reputational harm, or third-party claims, arising from use of the software, even where the possibility of such damage was known.

Where liability cannot be excluded, it is limited to the greater of the amount you paid Launchworks for the software in the twelve months preceding the claim, or one hundred United States dollars.

## Third-party services

Agent OS connects to services operated by others, including model providers, email providers, and any integration you configure. Those relationships are between you and them. Launchworks does not control their availability, pricing, terms, or handling of your data, and is not responsible for what they do or fail to do.

## Acceptance

Running the software is acceptance of these terms. If you do not accept them, do not run it.

---

*Launchworks. Governing law and venue to be specified before this document is relied on commercially.*
