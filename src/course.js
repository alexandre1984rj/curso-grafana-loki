import { mapa, E1, Q1 } from './modules/mapa.js';
import { escrita } from './modules/escrita.js';
import { leitura } from './modules/leitura.js';
import { operacao } from './modules/operacao.js';
import { labels } from './modules/labels.js';
import { K, layers, lokiTag, lokiCommit, alloyTag } from './modules/helpers.js';

export const consultedAt = '2026-11-11';
export const versions = { loki: '3.7.0', alloy: '1.11.0', grafana: '12.2.0', lokiSource: lokiTag, lokiCommit, alloySource: alloyTag };
export const evidenceKinds = K;
export { layers, E1, Q1 };
export const modules = [...mapa, ...labels, ...escrita, ...leitura, ...operacao];
