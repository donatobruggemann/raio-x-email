#!/usr/bin/env node
/**
 * raio-x-email: o que qualquer pessoa consegue ver, de fora, sobre o email de um domínio.
 *
 *   npx tsx src/cli.ts seudominio.com.br            relatório em português
 *   npx tsx src/cli.ts seudominio.com.br --json     dados brutos
 *   npx tsx src/cli.ts seudominio.com.br --sem-site só o domínio, sem abrir o site
 */
import { auditarDominio } from "./dominio";
import { lerCamadaDoSite, type CamadaDoSite } from "./site";
import { pontosDoDominio, pontosDoSite } from "./relatorio";

const CATEGORIA: Record<string, string> = {
  email: "Captura e email",
  checkout: "Venda",
  medicao: "Medição de visita e anúncio",
  site: "Onde o site é feito",
  atendimento: "Atendimento",
};

function limpar(entrada: string): string {
  return entrada.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
}

async function main() {
  const args = process.argv.slice(2);
  const alvo = args.find((a) => !a.startsWith("--"));
  if (!alvo) {
    console.log("uso: npx tsx src/cli.ts seudominio.com.br [--json] [--sem-site]");
    process.exit(1);
  }
  const dominio = limpar(alvo);
  const semSite = args.includes("--sem-site");

  const [dns, site] = await Promise.all([
    auditarDominio(dominio),
    semSite ? Promise.resolve(null) : lerCamadaDoSite(dominio).catch((e): CamadaDoSite | null => {
      console.error(`(o site não foi lido: ${e instanceof Error ? e.message.split("\n")[0] : e})`);
      return null;
    }),
  ]);

  if (args.includes("--json")) {
    console.log(JSON.stringify({ dominio: dns, site }, null, 2));
    return;
  }

  const out: string[] = [];
  out.push(`\nRAIO-X DO EMAIL DE ${dominio.toUpperCase()}`);
  out.push(`medido em ${new Date().toLocaleString("pt-BR")}, só com informação pública, sem enviar nada a ninguém\n`);

  if (dns.dominio_inexistente) {
    out.push("Esse domínio não existe no registro público (vencido, digitado errado ou nunca registrado). Nada a medir.");
    console.log(out.join("\n"));
    return;
  }
  if (dns.dns_indeterminado) {
    out.push(`Algumas consultas falharam (${dns.dns_falhas.join(", ")}). Para não errar, nenhuma conclusão foi tirada. Tente de novo em alguns minutos.`);
    console.log(out.join("\n"));
    return;
  }

  const d = pontosDoDominio(dns);
  const doSite = site ? pontosDoSite(site, dns) : [];
  const abertos = [...d.abertos, ...doSite];

  out.push(`${abertos.length} ponto(s) aberto(s), ${d.certos.length} em ordem\n`);
  if (abertos.length) {
    out.push("O QUE ESTÁ ABERTO");
    abertos.forEach((p, i) => out.push(`  ${i + 1}. ${p.titulo}\n     ${p.texto}`));
    out.push("");
  }
  if (d.certos.length) {
    out.push("O QUE ESTÁ EM ORDEM");
    d.certos.forEach((p) => out.push(`  - ${p.titulo}`));
    out.push("");
  }

  if (site?.carregou) {
    out.push("O QUE O SITE FAZ COM QUEM CHEGA NELE");
    out.push(`  páginas lidas: ${site.paginasLidas.map((u) => u.replace(/^https?:\/\//, "")).join(", ")}`);
    for (const cat of Object.keys(CATEGORIA)) {
      const fs = site.ferramentas.filter((f) => f.categoria === cat);
      if (fs.length) out.push(`  ${CATEGORIA[cat]}: ${fs.map((f) => f.nome).join(", ")}`);
    }
    for (const f of site.formularios) {
      out.push(`  formulário em ${f.pagina.replace(/^https?:\/\//, "")}: pede ${f.campos.map((c) => c.split(":")[1]).join(", ")} e entrega para ${f.ferramenta ?? "destino não identificado"}`);
    }
    if (!site.formularios.length) out.push("  nenhum formulário de captura nas páginas lidas");
    out.push("  (a prova de cada ferramenta, a URL que a denunciou, sai com --json)\n");
  } else if (site && !site.carregou) {
    out.push(`O site não abriu: ${site.erro ?? "sem resposta"}\n`);
  }

  out.push("O QUE ESTE RELATÓRIO NÃO MOSTRA");
  out.push("  Se algum email seu já foi falsificado, se os seus envios chegam na caixa principal, e como");
  out.push("  fechar cada ponto. Isso pede acesso às contas e muda de provedor para provedor.\n");
  console.log(out.join("\n"));
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
