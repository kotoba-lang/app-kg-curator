# etzhayyim-project-kg-curator — KG Curator Runbook

## Project Overview

`kg-curator.etzhayyim.com` (nanoid `kg7r4t0r`) — LLM-driven knowledge graph expansion for media-gamers and other AppView projects. **All inference on-prem (Linode g2-gpu-rtx4000a1-l GPU node)** — no Workers AI / Anthropic / OpenAI external calls.

**Component**: `appview/kg-curator-kg7r4t0r/`
**Runtime**: Single Worker (T2 hybrid)
**Trigger**: nightly cron 03:17 JST + manual + queue consumer

## On-Prem Inference Stack (LIVE 2026-04-15+)

| Service | Endpoint | Model | Use |
|---|---|---|---|
| Ollama | `http://172-236-133-64.ip.linodeusercontent.com/v1/chat/completions` | `gemma4:e4b` (Tier 0b) | JSON / structured extraction |
| Ollama | 同上 | `gemma4:e2b` (Tier 0a) | general / lighter |
| TEI | `https://embed.etzhayyim.com/embed` | `google/embeddinggemma-300m` (768-dim) | similarity dedup |

CF Worker からは Linode NB hostname で直叩き (gray-cloud DNS は routing-gateway が intercept する)。VRAM 余り 8 GiB / 20 GiB に余裕あり、KG curator 追加負荷ゼロコスト。

## Pipeline

```
03:17 JST cron
  ↓
analyzeCoverage (kaisya_app SELECT)
  ↓ sparse titles (target=12 chars each)
KG_GEN_QUEUE (CF Queue)
  ↓ batch 4 / 30s timeout
queue consumer
  ↓
1. SELECT existing vertex_game_character WHERE title_did = X
2. Ollama gemma4:e4b call: "generate 12-N more chars for {title}"
   - response_format: json_schema with strict slug pattern
3. TEI embed: 768-dim normalized vectors for new entities
4. cosine dedup (slug match for now; pgvector IVF future)
5. INSERT vertex_game_character (graph layer)
6. INSERT vertex_actor (T0 identity, execution_tier='T0', classification='T0-llm-generated')
7. INSERT vertex_actor_manifest (profile_json with LLM provenance)
```

## T0 (DB-only, LLM-generated) Identity Convention

各新規 entity は以下を満たす:

- `did:etzhayyim:gamechar:{slug}` (synthetic ID)
- `vertex_actor.execution_tier = 'T0'`
- `vertex_actor.classification = 'T0-llm-generated'`
- `vertex_actor_manifest.profile_json` に `llm_generated:true`, `llm_model:'gemma4:e4b'`, `llm_node:'linode-g2-gpu-rtx4000a1-l'`, `generated_at` ISO8601 を記録 (audit trail)

ローカル jsonld、did.json、PDS profile record いずれも不要。RisingWave 内で identity 完結。

## Build & Deploy

```bash
cd 60-apps/etzhayyim-project-kg-curator/appview/kg-curator-kg7r4t0r
etzhayyim deploy --no-svelte
```

## API Endpoints

- `https://kg7r4t0r.etzhayyim.com/xrpc/com.etzhayyim.apps.kgCurator.analyzeCoverage` (POST)
- `https://kg7r4t0r.etzhayyim.com/xrpc/com.etzhayyim.apps.kgCurator.expandTitle` (POST `{scope_did, target_count}`)
- `https://kg7r4t0r.etzhayyim.com/xrpc/com.etzhayyim.apps.kgCurator.status` (GET)

## Cluster Health Caveat

RisingWave 単一 compute node `g2-gpu-rtx4000a1-l × 1` (14 vCPU)、ADAPTIVE/256 を 878 jobs (28K streaming actors) が共有。GPU co-tenant inference active 時 INSERT silent loss が発生 → KG curator は **defensive double-INSERT + probe-retry** パターン推奨。

## Future

- pgvector / RisingWave IVF index で `vertex_actor_manifest.profile_embedding` (768-dim) を IVF approximate-KNN dedup
- `kgCurator.expandItems` / `kgCurator.expandQuests` の各 mutation type を追加
- T0 → T1 promotion path: cohort actor (ADR-0026) と統合し、follower 蓄積→個別 actor 昇格
- Multi-AppView coverage: media-anime, society6, narou 等への拡張
