# app-kg-curator（T0 identity）— itonami（dapp）上の分散型設計

状態: 第 1 スライス実装（2026-10-20）。正本はこの文書。
追跡: Linear JUN-128（親 JUN-116）。

## 位置づけ

app-kg-curator は LLM 駆動の知識グラフ拡張（kg-curator.etzhayyim.com）。
**推論はすべて on-prem**（Linode GPU の Ollama gemma4 + TEI embedding、
外部 AI なし）。生成 entity は **T0 identity**（DB 内で完結する合成
identity）で、**出所（provenance）の監査証跡を必ず持つ**。

## このスライス: T0 判定コア

| 層 | 実体 | 状態 |
|---|---|---|
| 判定コア guest | `aiueos/kg_t0.cljk` — t0-consistent（合成 ID `did:etzhayyim:gamechar:{slug}` / tier T0 / classification T0-llm-generated）/ provenance-ok（**監査証跡 4 項目**: llm_generated / llm_model / llm_node / generated_at）/ dedup-judgment（slug 一致 or cosine 類似超過で落とす）/ inference-ok（**on-prem のみ**、外部 AI は違反） | **実装済み・実測** |
| 記述子 | `aiueos/kg-t0.edn` | **実装済み** |
| parity | `appview/kg-curator-kg7r4t0r/kg/t0_parity_test.cljk` — 正本（AGENTS.md の Pipeline / T0 Identity Convention）の規約一致検査 | **実装済み・実測** |

実測: `amu test aiueos/kg_t0.cljk` → **15/15**（jvm-kir / js / wasm）。
parity → 9 assertions / 0 failures。

## 正本の正確な規則（guest はこれに追従）

- **T0 identity convention**: 合成 ID / `execution_tier='T0'` /
  `classification='T0-llm-generated'`。「ローカル jsonld、did.json、PDS
  profile record いずれも不要。RisingWave 内で identity 完結」。
- **provenance 必須**: `profile_json` に `llm_generated:true` / `llm_model` /
  `llm_node` / `generated_at`（ISO8601）を記録 —— 監査証跡無しの生成 entity
  は通さない（guest の provenance-ok が fail closed）。
- **dedup**: 「cosine dedup (slug match for now; pgvector IVF future)」。
- **推論は on-prem のみ**（「no Workers AI / Anthropic / OpenAI external
  calls」）。guest の inference-ok が境界を固定。

## 未実装境界

- slug の厳密な形（json_schema strict pattern）の判定。
- cosine 類似のしきい値判定（TEI 768-dim の実計算は host）。
- analyzeCoverage / queue のバッチング（batch 4 / 30s timeout）。
- mon（DNA）化、aiueos session 載せ（fleet 共通）。
