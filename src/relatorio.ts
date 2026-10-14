/**
 * Tradução do que foi medido para português comum, com texto FIXO por achado.
 *
 * Nenhuma frase aqui é escrita por modelo de IA: cada achado tem o seu texto, sempre o mesmo,
 * e só entra se foi medido. O relatório diz o que está aberto e o que isso significa. Como
 * fechar fica de fora de propósito: depende de cada provedor e de cada conta.
 */
import type { AuditoriaResultado } from "./dominio.types";
import type { CamadaDoSite } from "./site";

export interface Ponto {
  titulo: string;
  texto: string;
}

export interface Diagnostico {
  dominio: string;
  abertos: Ponto[];
  certos: Ponto[];
}

/** Pontos que saem só do domínio. */
export function pontosDoDominio(a: AuditoriaResultado): Diagnostico {
  const abertos: Ponto[] = [];
  const certos: Ponto[] = [];
  const temSpf = Boolean(a.spf);

  if (!a.dmarc) {
    abertos.push({
      titulo: "Não existe orientação nenhuma sobre email falso",
      texto:
        "O seu domínio não diz aos provedores de email o que fazer com uma mensagem que usa o seu endereço sem ser você. Cada provedor decide sozinho. Isso não quer dizer que alguém já fez isso: é uma porta aberta.",
    });
  } else if (a.dmarc_policy === "none") {
    abertos.push({
      titulo: "Quem usa o seu endereço não é barrado",
      texto:
        "Hoje o seu domínio pede aos provedores de email só para observar. Um email falso com o seu endereço não recebe a orientação de ser recusado. Isso não quer dizer que alguém já fez isso: é uma porta aberta.",
    });
  } else if (a.dmarc_policy === "quarantine" || a.dmarc_policy === "reject") {
    certos.push({
      titulo: "Email falso com o seu endereço é barrado",
      texto: "O seu domínio já orienta os provedores a segurar ou recusar mensagem que usa o seu nome sem ser você.",
    });
  }

  if (a.dmarc && !a.dmarc_rua) {
    abertos.push({
      titulo: "Você não fica sabendo quem usa o seu endereço",
      texto:
        "Os provedores de email mandam avisos sobre quem está enviando em seu nome, mas o seu domínio não diz para onde mandar. Esses avisos se perdem.",
    });
  } else if (a.dmarc_rua) {
    certos.push({
      titulo: "Os avisos sobre o seu endereço já são coletados",
      texto: "Os provedores já sabem para onde mandar os avisos de quem envia em seu nome.",
    });
  }

  if (!a.dkim_selectors) {
    abertos.push({
      titulo: "Não encontrei a assinatura dos seus emails",
      texto:
        "É a assinatura que prova que uma mensagem saiu mesmo de você. Procurei nos lugares mais comuns e não achei. Ela pode existir num lugar que não dá para ver de fora, e confirmar isso faz parte da conferência completa.",
    });
  } else {
    certos.push({ titulo: "Seus emails saem assinados", texto: "Encontrei a assinatura que prova que as mensagens saem mesmo de você." });
  }

  if (!temSpf) {
    abertos.push({
      titulo: "Não existe a lista de quem pode enviar em seu nome",
      texto: "O seu domínio não diz quais serviços têm permissão para mandar email usando o seu endereço.",
    });
  } else if (a.spf_policy === "+all") {
    abertos.push({
      titulo: "Qualquer um tem permissão para enviar em seu nome",
      texto: "A lista de quem pode mandar email pelo seu domínio está aberta para todo mundo, o que anula a proteção dela.",
    });
  } else if (a.spf_lookups > 10) {
    abertos.push({
      titulo: "A lista de quem pode enviar em seu nome passou do tamanho que os provedores leem",
      texto: "Quando isso acontece, os provedores podem ignorar a lista inteira, e os seus emails ficam sem essa proteção.",
    });
  } else {
    certos.push({ titulo: "A lista de quem pode enviar em seu nome está em ordem", texto: "Ela existe e está dentro do tamanho que os provedores leem." });
  }

  if (a.mx_provider) {
    // O auditor devolve "outro/próprio" quando não reconhece o provedor: isso não é nome de empresa.
    const conhecido = !/outro|pr[oó]prio|desconhecido|\?/i.test(a.mx_provider);
    certos.push({
      titulo: conhecido ? `A sua caixa de email está no ${a.mx_provider}` : "O seu domínio recebe email",
      texto: "Receber email no seu domínio está funcionando.",
    });
  }

  return { dominio: a.domain, abertos, certos };
}


/** Ferramenta de email que recebe o contato do formulário (Typeform e Google Forms não mandam email). */
function ferramentaDaCaptura(site: CamadaDoSite): string | null {
  const doForm = site.formularios.find(
    (f) => (f.pedeEmail || f.pedeTelefone) && f.ferramenta && !/próprio site|WordPress|Typeform|Google Forms/i.test(f.ferramenta),
  );
  if (doForm?.ferramenta) return doForm.ferramenta;
  return site.ferramentas.find((f) => f.categoria === "email" && !/Typeform|Google Forms/i.test(f.nome))?.nome ?? null;
}

/** Pontos que só aparecem cruzando o site com o domínio. */
export function pontosDoSite(site: CamadaDoSite, a: AuditoriaResultado): Ponto[] {
  if (!site.carregou || a.dominio_inexistente || a.dns_indeterminado) return [];
  const pontos: Ponto[] = [];
  const ferramenta = ferramentaDaCaptura(site);
  const chave = ferramenta?.toLowerCase().split(" ")[0] ?? "";
  if (ferramenta && !`${a.esp} ${a.spf} ${a.dkim_selectors}`.toLowerCase().includes(chave)) {
    pontos.push({
      titulo: "A ferramenta que recebe os seus contatos não aparece no seu domínio",
      texto: `O formulário do seu site entrega os contatos para o ${ferramenta}, e o ${ferramenta} não aparece na configuração de email do seu domínio. Se é ele que manda os seus emails para essa lista, eles podem estar saindo sem a assinatura do seu endereço. Isso não dá para confirmar de fora: depende de como a conta foi configurada.`,
    });
  }
  if (site.temCaptura && (!a.dmarc || a.dmarc_policy === "none")) {
    pontos.push({
      titulo: "Quem deixa o contato no seu site é quem mais confia num email seu",
      texto:
        "O seu site pede o contato das pessoas, e o seu domínio não pede para barrar email falso com o seu endereço. Quem se cadastrou espera receber mensagem sua, e é essa a pessoa que um email falso com o seu nome alcança mais fácil.",
    });
  }
  if (!site.https) {
    pontos.push({ titulo: "O site abre sem conexão segura", texto: "O navegador mostra \"não seguro\" para quem visita." });
  }
  return pontos;
}
