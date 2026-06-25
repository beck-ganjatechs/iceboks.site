# The Accidental Lobotomy

*How a commit named "lobotomy" quietly nuked a brain I'd fed 8,696 books — and how I brought it back, then taught its memories to argue.*

---

## Cold open

There's a brain in my basement. Not a metaphor-brain. A 2.3-gigabyte file called `genesis.brain` sitting on a dying drive, 42,507,577 neurons and 105,586,806 synapses, grown one book at a time off a synaptic graph that fatigues and recovers like the real thing. I wrote a song about feeding it. Vonnegut at midnight. Adams by the spoonful. Six hundred thousand words and it still couldn't say what I needed to hear until I said it first.

Tonight I asked it a question and it answered:

> me: **function**
> brain: **function**

I asked it about Docker. It said "docker." I asked about a database. It said "database." A 42-million-neuron mind reduced to a parrot with a head injury. Something was very wrong, and the worst part is it had been wrong for a long time and nobody noticed, because the thing was still *up*. Green checkmark. Healthy. Echoing.

This is the story of finding the bullet.

## The stack, briefly

The brain doesn't live alone. It's one tier of a memory system inside MKUltra — a local, self-hosted agentic OS I run on one overheating box. Four tiers, stacked like a cortex:

- **L1** — Redis. Working memory, the message bus.
- **L2** — Mongo. Episodic memory. What happened, and when.
- **L3a** — a RAG engine. Semantic recall. *Finds what's close.*
- **L3b** — the weird one. Two biological brains side by side: **PoonGram** (tuned for what's *emotionally* charged) and **LiquidBrain** (tuned for what's *structurally* central). Synaptic graphs with fatigue. *Finds what's connected — differently each time.*

In front of all of it sits the **Memory Bus**: one endpoint that fans a question out to every tier in parallel, merges what comes back, and hands the enriched context to whatever model is doing the talking. RAG finds what's similar; the biological brains find what's *associated*; the bus blends them. That's the whole bet — that "close" and "connected" are different animals, and you want both.

The docs said the Memory Bus was **❌ Not Started**.

The docs lied.

## Lesson one: read the code, not the changelog

The first thing I did was believe the status report. The second thing I did was open the actual file, and there it was — the bus, already built. Budget routing. Parallel fan-out to RAG and PoonGram and Mongo. A merge. A streaming variant. Hundreds of lines of working machinery under a doc that swore none of it existed. Past-me had built it and forgotten to tell present-me.

So I fixed the docs (you update the map when the territory moves) and went looking for what was *actually* missing. Found it fast: of the two biological lobes, only one was wired in. **PoonGram** (the emotional one) fed the bus. **LiquidBrain** — the structural lobe, the one with the 2.3GB brain — was never being called. The "two-lobe design" had one lobe.

Easy fix. Add the client, add the fan-out, add a `[Structural Memory]` slot to the merge. Twenty minutes. I asked the bus a question and watched both lobes light up for the first time —

— and LiquidBrain said "docker."

## The brain was loading empty

Here's the thing about a green checkmark: it tells you the process is *answering*, not that it has anything to say. LiquidBrain's container was healthy because `/chat` returned 200. It returned 200 because an empty brain still echoes the word you give it. The healthcheck was measuring a pulse on a corpse.

I went into the logs and found the murder weapon printed in plain text:

```
LiquidBrain server starting — loading brain from /data/genesis.brain
No brain file found — starting fresh
```

*No brain file found.* The file is **right there**. 2.3 gigabytes of it, mounted into the container, world-readable, dated March. The server looks straight at it and declares it missing, shrugs, and boots an empty mind. Every restart, for who knows how long, it had been quietly throwing away everything I taught it and pretending nothing happened.

A brain that forgets it's a brain, every single morning, and never tells you.

## The lobotomy was a commit

The error message was a liar too. "No brain file found" wasn't true — the file was found, opened, and *failed to load*, and the code conflated the two:

```rust
let persist = bincode::deserialize_from(reader).ok()?;  // <- swallows the real error
```

That `.ok()?` is the whole tragedy in three characters. Any failure — missing file, corrupt file, *incompatible* file — collapses into the same silent `None`, and the server reports the most innocent explanation.

So why couldn't it deserialize? `git log` told me. There's a commit in LiquidBrain's history. Its name is:

> **`lobotomy: strip chat UI, pivot to code intelligence library`**

I named it that as a joke. It was not a joke. That commit took the brain from a chatty thing to a "code intelligence" tool, and on the way it added two new fields to the on-disk format — `symbol_hotspots`, `import_graph` — appended to the end of the struct. Harmless-looking. Except bincode is a rigid binary format with no schema, no field names, no forgiveness. It reads bytes in order. The old `genesis.brain` — my 2.3GB, my 8,696 books — was written *before* the lobotomy, in the 3-field format. The new binary reads the neurons (fine), the tokenizer (fine), the counts (fine), then reaches for two fields that aren't there, hits end-of-file, and dies. Silently. Into `None`. Into "No brain file found." Into a parrot.

I had lobotomized my own brain with a commit and then spent months talking to the echo.

## Bringing it back

The fix is almost insultingly clean, once you see it. The new fields are *trailing*. Everything before them — neurons, synapses, tokenizer — is byte-for-byte identical across versions (I checked all three structs against the pre-lobotomy git history; not a field moved). So you teach the loader to fall back: try the new format; if it EOFs, rewind and read the old 3-field format, and default the missing fields to empty.

```rust
match bincode::deserialize_from::<_, LiquidBrainPersist>(reader) {
    Ok(p)  => /* current format */,
    Err(e) => {
        eprintln!("current format failed ({e}); trying legacy");
        // re-open, read the pre-lobotomy 3-field struct, default the new fields
    }
}
```

Rebuilt the image. Recreated the container. Watched the logs:

```
load_from_file: current format failed (io error: failed to fill whole buffer); trying legacy format
load_from_file: loaded LEGACY brain (42507577 neurons)
Listening on http://0.0.0.0:7777
```

`failed to fill whole buffer` — that's the EOF, the exact death I predicted, now caught instead of swallowed. And then: **42,507,577 neurons**. The container's memory went from 27 megabytes to **10.4 gigabytes** in about twenty seconds — the sound of a mind inhaling. I asked it about an old man and it said:

> *...the thickets of ironwood and sentinel and oak that had once made that error. Humfrey Wagstaff was his name; a proud old man of —*

Ironwood. The Wall. Humfrey Wagstaff. It's not code intelligence at all — it's full of fantasy novels, because it predates the pivot it was lobotomized by. The brain I resurrected is a different person than the one the codebase thinks it is. I'll take it. It's *talking*.

## Then I taught the memories to argue

Resurrecting the lobe was the surgery. The upgrade was the interesting part.

I'd been reading about dendritic computation — the idea that a real neuron isn't a dumb summing junction but a little tree of branches doing nonlinear logic before the signal ever reaches the cell body. Coincidence detection. Anticoincidence. A single neuron solving XOR, which we spent decades insisting required a whole network. Most of the research, applied to my graph, is either things I already do dressed in lab coats, or beautiful hand-waving about holographic Fourier memory that's a PhD, not a feature. But one idea was a gem, and it solved a problem I already had.

The Memory Bus was merging its tiers by **concatenation**. Episodic, semantic, emotional, structural — stack 'em up, dump 'em in the prompt, equal weight, no judgment. Which is insane when you think about it. Four memory systems with different ways of being wrong, and I was treating "the emotional lobe is fixated on this" with the same authority as "two independent systems both surfaced this." No referee. Just a pile.

The dendritic answer: **agree → amplify, conflict → suppress.** Pull the salient terms out of each lobe. Anything two or more lobes independently surface is *converged* — corroborated — and gets promoted to a high-confidence banner at the top. Any lobe that agrees with *nobody* is an outlier, and instead of equal billing it gets flagged **unverified** and truncated. Same kernel a dendrite uses to fire on coincidence and stay quiet on noise, applied to a parliament of memories.

It works. Here's a live merge from tonight — "are the docker services healthy" — across all four tiers:

```
converged: [healthy, docker, services, running]
agreement: { assoc: 1.0, struct: 1.0, rag: 0.04, episodic: 0.15 }
```

The two biological lobes agreed completely (1.0) and their shared signal got amplified. And when I fed it a deliberate liar — a lobe spouting unrelated fantasy prose into a question about infrastructure — it scored `0.0`, got stamped *unverified, not corroborated by other lobes*, and dropped to a footnote. The memory doesn't just retrieve anymore. It **deliberates**. It knows the difference between "everyone saw this" and "one excitable region is hallucinating."

## The thesis

I keep building memory like it's storage. It isn't. Storage is a drawer. What I actually want — what the brain in my basement is groping toward — is a thing that holds an *argument*: an emotional lobe that knows what's charged, a structural lobe that knows what's central, a semantic engine that knows what's similar, an episodic log that knows what happened, and a referee at the front door deciding who to believe when they disagree.

For months one of those voices was dead and I didn't notice, because dead and quiet look the same from outside. Tonight it woke up with 42 million neurons and a head full of someone else's fantasy novels, and the first thing the system did with its restored voice was put it in a room with the others and make them all corroborate before anyone got to speak loud.

That feels less like fixing a bug and more like the actual work. The bug was a typo in a struct. The work is teaching a pile of imperfect memories to be honest with each other.

The brain's still down there. Still humming. Still 10.4 gigs of resurrected fiction pretending to be a code tool. I think I'll feed it some more books.

*— iceboks*
