import { CATEGORIES } from "@/lib/categories";

const SAMPLES: Record<string, string[]> = {
  "sobre-voce": ["Mora em Curitiba", "Faz aniversário em março", "Estuda design", "Acorda cedo", "Tem medo de altura", "É canhoto"],
  gostos: ["Ama café coado", "Prefere chuva a sol", "Gosta de gatos pretos", "Detesta coentro", "Pizza de calabresa", "Filmes do Ghibli"],
  pessoas: ["Irmã chamada Lia", "Amigo Rafa do trabalho", "Avó faz bolo de fubá", "Gata se chama Nina", "Mãe é professora"],
  conversas: ["Falamos sobre o futuro", "Discussão sobre IA", "Ideia de viagem ao Chile", "Lembrança da infância", "Conversa sobre sonhos"],
  sentimentos: ["Ansioso com a prova", "Feliz com o estágio", "Saudade da praia", "Cansado às sextas", "Orgulho do projeto"],
  planos: ["Prometi lembrar da consulta", "Quer aprender violão", "Viajar em julho", "Ler 20 livros no ano", "Começar a correr"],
  rotina: ["Academia às 7h", "Almoço ao meio-dia", "Reunião às segundas", "Dorme depois da meia-noite", "Café às 15h"],
  jogos: ["Joga Stardew Valley", "Zerou Hollow Knight", "Fã de Zelda", "Partidas de xadrez online", "Minecraft com amigos"],
};

export function makeDemoData() {
  const cats = CATEGORIES.filter((c) => SAMPLES[c.id]);
  const memories: { id: string; title: string; category: string; importance: number }[] = [];
  let i = 0;
  while (memories.length < 120) {
    const c = cats[i % cats.length]!;
    const list = SAMPLES[c.id]!;
    const base = list[Math.floor(i / cats.length) % list.length]!;
    memories.push({ id: `d${i}`, title: base, category: c.id, importance: 1 + Math.floor(Math.random() * 5) });
    i++;
  }
  const links: { source_id: string; target_id: string }[] = [];
  for (let k = 0; k < 70; k++) {
    const a = memories[Math.floor(Math.random() * memories.length)]!;
    const b = memories[Math.floor(Math.random() * memories.length)]!;
    if (a.id !== b.id) links.push({ source_id: a.id, target_id: b.id });
  }
  return { memories, links };
}
