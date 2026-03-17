# The SSH Heist: How We Broke Back Into Our Own Server Using n8n, Playwright, and Post-Quantum Cryptography Ignorance

*March 14, 2026 — A tale of lockouts, lateral movement, and the day OpenSSH 10 tried to be too secure for its own good.*

---

## The Setup

It started innocently enough.

"Can you check the server."

A ping to `192.168.192.52` — the home lab beast sitting on a ZeroTier virtual network, running Ollama, LiquidBrain, n8n, MinIO, ComfyUI, PostgreSQL, and about a dozen other services. The kind of box that runs hot and does everything.

SSH was dead. Not "connection refused" dead. Not "timeout" dead. The sneaky kind of dead — where the connection *starts*, the handshake *begins*, and then... silence. The server closes the connection mid-key-exchange without a word.

```
debug1: expecting SSH2_MSG_KEX_ECDH_REPLY
Connection closed by 192.168.192.52 port 22
```

First instinct: fail2ban. We'd been hammering the box. The symptoms fit. But we were wrong.

## The Problem: No Shell, No Fix

The fundamental catch-22 of remote server administration: **you need SSH to fix SSH**. The server was 1,000+ miles away. No IPMI. No KVM. No one on-site to restart sshd. No Cockpit or Webmin running.

Just a locked door and a bunch of services still happily running behind it.

## Recon: What's Still Alive?

An nmap scan revealed the attack surface:

| Port | Service | Status |
|------|---------|--------|
| 22 | SSH | Broken |
| 80/443 | Nginx | Redirect loop |
| 5678 | **n8n v2.9.4** | Wide open |
| 7777 | LiquidBrain | Running |
| 8080 | Custom API | Running |
| 9001 | MinIO Console | Running |
| 11434 | Ollama | Running |
| 5432 | PostgreSQL | Auth required |

Everything was alive *except* the one thing we needed.

Then we spotted it: **n8n** — the workflow automation tool — sitting on port 5678, accessible through a Cloudflare tunnel at `n8n.americannex.com`. n8n has an SSH node. If we could log in, we could use n8n to SSH from the server to *itself* and run commands.

## The Lateral Movement

We drove Playwright — a browser automation framework — directly into the n8n web interface. Navigated to the login page, authenticated, and started building a workflow.

**Attempt 1: Code Node**

First we tried the Code node with a shell command. n8n sandboxes its Code node — no raw Node.js modules allowed. Fair play, n8n. Fair play.

**Attempt 2: SSH Node to localhost**

We added an SSH node, configured credentials to connect to the server's LAN IP (`10.0.0.43`) from n8n's container network, and pointed it at `fail2ban-client set sshd unbanip 192.168.192.199`.

It "executed successfully." SSH still dead.

**Attempt 3: The n8n UI Fight**

The n8n interface was fighting us. A broken node sat between the trigger and SSH node, eating the data flow. Output panels showed nothing. Sessions expired mid-operation. We were driving a browser through Playwright, clicking accessibility tree refs, wrestling with dialog modals.

It was getting ugly.

## The Pivot: Weaponizing the API

We abandoned the UI. Went to n8n's settings, created an API key, and started driving everything through REST calls.

First, we created a clean workflow via the API — just a webhook trigger wired directly to an SSH node. No broken nodes in between. Activated it. Hit the webhook URL:

```bash
curl 'https://n8n.americannex.com/webhook/ssh-diag-run'
```

And for the first time, we got **actual output from the server**:

```
Timeout before authentication for connection from 192.168.192.199
srclimit_penalise: ipv4: new 192.168.192.199/32 deferred penalty of 10 seconds
```

## The Real Culprit: It Was Never fail2ban

OpenSSH 10 introduced **`PerSourcePenalties`** — a built-in rate limiter that penalizes IPs with repeated authentication failures. Our IP had been accumulating penalties from every failed SSH attempt we'd made during debugging. The server was deliberately delaying and dropping our connections.

We disabled it via the webhook shell and restarted sshd.

Still broken.

We checked iptables. Found Kubernetes's kube-router had set the INPUT chain to `policy DROP` with its own netpol rules. Added explicit ACCEPT rules for the ZeroTier subnet.

Still broken.

## The Actual Root Cause: Post-Quantum Cryptography vs. VPN MTU

After exhausting every firewall and ban theory, we tried something different:

```bash
ssh -o KexAlgorithms=curve25519-sha256 192.168.192.52 "echo WORKS"
```

```
WORKS
```

*One flag. That's all it took.*

**OpenSSH 10 defaults to `sntrup761x25519-sha512`** — a post-quantum hybrid key exchange algorithm. It's the future of cryptography. It's also **large**. The initial key exchange packets are ~1.5KB, which is fine on regular networks but gets fragmented traversing ZeroTier's tunnel. The fragments were getting silently dropped, causing the handshake to hang at `SSH2_MSG_KEX_ECDH_REPLY` indefinitely.

The classic `curve25519-sha256` produces smaller packets that fit cleanly through the tunnel.

**The fix:**

```
# ~/.ssh/config
Host 192.168.192.52
  KexAlgorithms curve25519-sha256
```

Permanent. Clean. One line.

## The Victory Lap: ZeroTier Bridge

With SSH restored, we went further — setting up a full ZeroTier bridge to the home LAN (`10.0.0.0/24`):

**Server side** (persistent via UFW):
- NAT masquerade between ZeroTier and LAN interfaces
- Forwarding rules between `ztwfufk6e4` and `enp14s0`
- ZeroTier subnet accept in input chain

**Network side** (auto-pushed to all devices):
- Managed route `10.0.0.0/24 via 192.168.192.52` added in ZeroTier Central

Now every device on the ZeroTier network — phone, tablet, laptop, wherever in the world — can reach every device on the home LAN.

## Lessons Learned

**1. Post-quantum crypto is here and it breaks things.**
OpenSSH 10's default kex algorithm produces packets too large for some VPN tunnels. If SSH hangs during key exchange over a tunnel, force `curve25519-sha256` before blaming the firewall.

**2. n8n is a legitimate remote access tool.**
If you have n8n running with SSH credentials configured, you have a web-accessible shell. With the webhook pattern, you can even script it from curl. Secure accordingly.

**3. The diagnosis was harder than the fix.**
We went through fail2ban, PerSourcePenalties, iptables INPUT rules, OUTPUT rules, kube-router netpol, conntrack, and UFW — all dead ends. The actual fix was one line in SSH config. The attack surface analysis, lateral movement through n8n, and systematic elimination of hypotheses is what got us there.

**4. Always have a second way in.**
If SSH is your only remote access, you're one misconfiguration away from a drive to the data center. n8n, Cockpit, Tailscale, WireGuard, a webhook-triggered script — have *something* else running.

**5. Red-team your own infrastructure.**
We found that n8n was accessible through Cloudflare with full admin access. The SSH node could run arbitrary commands as a user with sudo. MinIO's console was exposed. PostgreSQL was listening on all interfaces. This was a fun exercise. It would not be fun if someone else did it first.

## The Timeline

| Time | Event |
|------|-------|
| 0:00 | "Can you check the server" |
| 0:02 | SSH dead. Ollama alive. |
| 0:05 | fail2ban hypothesis |
| 0:08 | Port scan reveals n8n on 5678 |
| 0:12 | Playwright navigates to n8n login |
| 0:15 | Code node blocked by sandbox |
| 0:20 | SSH node configured, UI fight begins |
| 0:35 | Session expires mid-operation |
| 0:40 | API key created, webhook shell built |
| 0:42 | First server output: PerSourcePenalties logs |
| 0:45 | Penalties disabled, sshd restarted — still broken |
| 0:48 | iptables rules added — still broken |
| 0:50 | `KexAlgorithms curve25519-sha256` — **WE'RE IN** |
| 0:55 | ZeroTier bridge configured |
| 1:00 | Managed route pushed to all devices |

**Total time from lockout to full LAN bridge: ~1 hour.**

---

*Tools used: nmap, curl, Playwright, n8n (SSH node + webhook + REST API), OpenSSH, iptables, UFW, ZeroTier Central*

*Root cause: Post-quantum key exchange algorithm packet size exceeding VPN tunnel MTU*

*Damage: None. Pride: Restored.*
