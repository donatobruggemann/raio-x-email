/**
 * Camada do site: o que o site faz com quem chega nele.
 *
 * A leitura do domínio mostra se o endereço pode ser usado para falsificar email. Esta camada
 * olha o outro lado, o que só aparece abrindo o site como um visitante: para qual ferramenta
 * o formulário entrega o contato, que medição de anúncio está instalada, onde fica o checkout,
 * se existe botão de WhatsApp. Tudo com prova (a URL do script ou da requisição que denunciou a
 * ferramenta), porque a regra é nunca afirmar o que não se mediu.
 *
 * Regras duras:
 * - Nunca envia formulário. Mandar um contato falso para a lista de alguém seria sujar a base
 *   dele e mentir sobre o que se testou. O destino do formulário é lido do HTML, não testado.
 * - Navegador limpo, sem sessão e sem cookie de ninguém.
 * - Só o domínio pedido e as páginas internas dele; links externos são anotados, não abertos.
 */

import { chromium, type Browser, type Page } from "playwright-core";
import fs from "fs";
import path from "path";

/** Chromium do Playwright (npx playwright-core install chromium); CHROMIUM_PATH sobrepõe. */
function binarioDoChromium(): string | undefined {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const base = path.join(process.env.HOME || process.env.USERPROFILE || "", ".cache", "ms-playwright");
  const pasta = fs.existsSync(base) ? fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().pop() : undefined;
  if (!pasta) return undefined; // deixa o playwright-core procurar sozinho
  const linux = path.join(base, pasta, "chrome-linux64", "chrome");
  return fs.existsSync(linux) ? linux : undefined;
}

export type Categoria = "email" | "checkout" | "medicao" | "site" | "atendimento";

export interface FerramentaVista {
  nome: string;
  categoria: Categoria;
  /** A URL que denunciou a ferramenta: script carregado, requisição feita ou link na página. */
  prova: string;
  pagina: string;
}

export interface FormularioVisto {
  pagina: string;
  /** Para onde o formulário manda, lido do atributo action (ou do script que o controla). */
  destino: string;
  ferramenta: string | null;
  campos: string[];
  pedeEmail: boolean;
  pedeTelefone: boolean;
}

export interface CamadaDoSite {
  dominio: string;
  urlFinal: string | null;
  carregou: boolean;
  erro?: string;
  https: boolean;
  paginasLidas: string[];
  ferramentas: FerramentaVista[];
  formularios: FormularioVisto[];
  whatsapp: string[];
  /** Captura de contato existe em alguma página lida? */
  temCaptura: boolean;
  medidoEm: string;
}

// Assinatura -> ferramenta. A prova é a URL que bateu, guardada inteira.
const ASSINATURAS: Array<{ re: RegExp; nome: string; categoria: Categoria }> = [
  // ferramentas de email e captura
  { re: /trackcmp\.net|activehosted\.com|\.activecampaign\.com|\/proc\.php\?/i, nome: "ActiveCampaign", categoria: "email" },
  { re: /rdstation\.com\.br|rd\.services|d335luupugsy2\.cloudfront\.net/i, nome: "RD Station", categoria: "email" },
  { re: /list-manage\.com|chimpstatic\.com|mailchimp\.com/i, nome: "Mailchimp", categoria: "email" },
  { re: /sibforms\.com|sendinblue\.com|brevo\.com|sib-forms/i, nome: "Brevo", categoria: "email" },
  { re: /leadlovers\.com/i, nome: "Leadlovers", categoria: "email" },
  { re: /mailerlite\.com|mlcdn\.com|ml-attr/i, nome: "MailerLite", categoria: "email" },
  { re: /convertkit\.com|ck\.page|kit\.com\/forms/i, nome: "Kit (ConvertKit)", categoria: "email" },
  { re: /hs-scripts\.com|hsforms\.(com|net)|hubspot\.com|hs-analytics/i, nome: "HubSpot", categoria: "email" },
  { re: /klaviyo\.com/i, nome: "Klaviyo", categoria: "email" },
  { re: /getresponse\.com|gr-cdn\.com/i, nome: "GetResponse", categoria: "email" },
  { re: /e-goi\.com|egoiapp/i, nome: "E-goi", categoria: "email" },
  { re: /mautic/i, nome: "Mautic", categoria: "email" },
  { re: /builderall\.com/i, nome: "Builderall", categoria: "email" },
  { re: /klicksend|klickart/i, nome: "Klickpages / KlickSend", categoria: "email" },
  { re: /typeform\.com/i, nome: "Typeform", categoria: "email" },
  { re: /docs\.google\.com\/forms|forms\.gle/i, nome: "Google Forms", categoria: "email" },
  // checkout
  { re: /hotmart\.com/i, nome: "Hotmart", categoria: "checkout" },
  { re: /kiwify\.com\.br/i, nome: "Kiwify", categoria: "checkout" },
  { re: /eduzz\.com/i, nome: "Eduzz", categoria: "checkout" },
  { re: /monetizze\.com\.br/i, nome: "Monetizze", categoria: "checkout" },
  { re: /greenn\.com\.br/i, nome: "Greenn", categoria: "checkout" },
  { re: /ticto\.(com\.br|app)/i, nome: "Ticto", categoria: "checkout" },
  { re: /braip\.com/i, nome: "Braip", categoria: "checkout" },
  { re: /perfectpay\.com\.br/i, nome: "PerfectPay", categoria: "checkout" },
  { re: /doppus\.com/i, nome: "Doppus", categoria: "checkout" },
  { re: /pagar\.me|mercadopago|pagseguro|checkout\.stripe|buy\.stripe/i, nome: "Gateway de pagamento", categoria: "checkout" },
  // medição
  { re: /connect\.facebook\.net\/.*fbevents|facebook\.com\/tr\?/i, nome: "Pixel da Meta", categoria: "medicao" },
  { re: /googletagmanager\.com\/gtm\.js/i, nome: "Google Tag Manager", categoria: "medicao" },
  { re: /googletagmanager\.com\/gtag\/js\?id=G-|google-analytics\.com\/g\/collect/i, nome: "Google Analytics 4", categoria: "medicao" },
  { re: /googletagmanager\.com\/gtag\/js\?id=AW-|googleadservices\.com/i, nome: "Google Ads", categoria: "medicao" },
  { re: /analytics\.tiktok\.com/i, nome: "Pixel do TikTok", categoria: "medicao" },
  { re: /static\.hotjar\.com/i, nome: "Hotjar", categoria: "medicao" },
  { re: /clarity\.ms/i, nome: "Microsoft Clarity", categoria: "medicao" },
  // site
  { re: /\/wp-content\/|\/wp-includes\//i, nome: "WordPress", categoria: "site" },
  { re: /elementor/i, nome: "Elementor", categoria: "site" },
  { re: /wixstatic\.com|parastorage\.com/i, nome: "Wix", categoria: "site" },
  { re: /cdn\.shopify\.com/i, nome: "Shopify", categoria: "site" },
  { re: /nuvemshop|tiendanube/i, nome: "Nuvemshop", categoria: "site" },
  { re: /greatpages\.com\.br/i, nome: "GreatPages", categoria: "site" },
  { re: /leadpages\.(net|com)/i, nome: "Leadpages", categoria: "site" },
  { re: /webflow\.(com|io)/i, nome: "Webflow", categoria: "site" },
  { re: /kajabi/i, nome: "Kajabi", categoria: "site" },
  { re: /squarespace/i, nome: "Squarespace", categoria: "site" },
  // atendimento
  { re: /wa\.me\/|api\.whatsapp\.com|web\.whatsapp\.com/i, nome: "WhatsApp", categoria: "atendimento" },
  { re: /manychat|chatfuel|blip\.ai|zenvia|tawk\.to|jivochat|crisp\.chat|intercom/i, nome: "Chat no site", categoria: "atendimento" },
];

// Página interna que provavelmente captura contato.
const PAGINA_DE_CAPTURA = /lista|espera|inscri|gratis|gratuit|ebook|e-book|captura|aula|masterclass|webinar|newsletter|material|contato|cadastro/i;
const MAX_PAGINAS = 4;

function identificar(url: string): { nome: string; categoria: Categoria } | null {
  for (const a of ASSINATURAS) if (a.re.test(url)) return { nome: a.nome, categoria: a.categoria };
  return null;
}

function mesmoSite(url: string, dominio: string): boolean {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    return h === dominio || h.endsWith(`.${dominio}`);
  } catch {
    return false;
  }
}

async function lerPagina(aba: Page, url: string, dominio: string, achados: CamadaDoSite) {
  const requisicoes: string[] = [];
  const ouvir = (r: { url(): string }) => requisicoes.push(r.url());
  aba.on("request", ouvir);
  try {
    await aba.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    // Pixel e formulário de terceiro costumam carregar depois do DOM.
    await aba.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => null);
    await aba.waitForTimeout(2_000);
  } finally {
    aba.off("request", ouvir);
  }
  const atual = aba.url();
  achados.paginasLidas.push(atual);

  const dom = await aba.evaluate(() => {
    const links = Array.from(document.querySelectorAll("a[href]")).map((a) => (a as HTMLAnchorElement).href);
    const scripts = Array.from(document.querySelectorAll("script[src], iframe[src]")).map((s) => (s as HTMLScriptElement).src);
    const embutido = Array.from(document.querySelectorAll("script:not([src])"))
      .map((s) => s.textContent || "")
      .join("\n")
      .slice(0, 200_000);
    const formularios = Array.from(document.querySelectorAll("form")).map((f) => ({
      action: (f as HTMLFormElement).getAttribute("action") || "",
      acaoAbsoluta: (f as HTMLFormElement).action || "",
      classe: (f.getAttribute("class") || "") + " " + (f.getAttribute("id") || ""),
      campos: Array.from(f.querySelectorAll("input, select, textarea"))
        .filter((c) => !["hidden", "submit", "button"].includes((c as HTMLInputElement).type) && !/^b_[0-9a-f]{10,}/.test((c as HTMLInputElement).name || ""))
        .map((c) => {
          const i = c as HTMLInputElement;
          return `${i.type || c.tagName.toLowerCase()}:${i.name || i.id || i.placeholder || "?"}`;
        }),
    }));
    return { links, scripts, embutido, formularios };
  });

  const vistos = new Set(achados.ferramentas.map((f) => f.nome));
  const anotar = (prova: string) => {
    const id = identificar(prova);
    if (!id || vistos.has(id.nome)) return;
    vistos.add(id.nome);
    achados.ferramentas.push({ ...id, prova: prova.slice(0, 220), pagina: atual });
  };
  for (const u of [...requisicoes, ...dom.scripts, ...dom.links]) anotar(u);
  // Script embutido (GTM/pixel colado no HTML) denuncia pelo texto, a prova vira o trecho.
  for (const a of ASSINATURAS) {
    const m = dom.embutido.match(a.re);
    if (m && !vistos.has(a.nome)) {
      vistos.add(a.nome);
      achados.ferramentas.push({ nome: a.nome, categoria: a.categoria, prova: `script na página: …${m[0]}…`, pagina: atual });
    }
  }

  for (const w of dom.links.filter((l) => /wa\.me\/|api\.whatsapp\.com/i.test(l))) {
    if (!achados.whatsapp.includes(w)) achados.whatsapp.push(w);
  }

  for (const f of dom.formularios) {
    if (!f.campos.length) continue;
    // busca do site (um campo só, chamado s/q/search) não é captura
    if (f.campos.some((c) => /:(s|q|search|busca)$/i.test(c))) continue;
    // login de área de membros não é captura
    if (f.campos.some((c) => /^password:/i.test(c))) continue;
    const destino = f.acaoAbsoluta || atual;
    const porAcao = identificar(destino);
    const porClasse = identificar(f.classe);
    const ferramenta = porAcao?.nome ??
      (porClasse?.nome === "Elementor" ? "formulário do próprio site (Elementor)" : porClasse?.nome) ??
      (/admin-ajax\.php|wp-json/i.test(destino) ? "formulário do próprio WordPress" : null);
    const campos = f.campos.slice(0, 8);
    achados.formularios.push({
      pagina: atual,
      destino: f.action ? destino.slice(0, 200) : "(sem action: o envio é feito por script)",
      ferramenta,
      campos,
      pedeEmail: campos.some((c) => /^email:|mail/i.test(c)),
      pedeTelefone: campos.some((c) => /^tel:|fone|phone|whats|celular/i.test(c)),
    });
  }

  return dom.links.filter((l) => mesmoSite(l, dominio));
}

export async function lerCamadaDoSite(dominio: string, navegadorEmprestado?: Browser): Promise<CamadaDoSite> {
  const achados: CamadaDoSite = {
    dominio,
    urlFinal: null,
    carregou: false,
    https: false,
    paginasLidas: [],
    ferramentas: [],
    formularios: [],
    whatsapp: [],
    temCaptura: false,
    medidoEm: new Date().toISOString(),
  };
  const navegador =
    navegadorEmprestado ??
    (await chromium.launch({
      executablePath: binarioDoChromium(),
      headless: true,
      timeout: 120_000,
      args: ["--lang=pt-BR", "--disable-gpu", "--disable-extensions", "--no-sandbox"],
    }));
  const contexto = await navegador.newContext({
    locale: "pt-BR",
    viewport: { width: 1366, height: 900 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  });
  const aba = await contexto.newPage();
  try {
    let internos: string[];
    try {
      internos = await lerPagina(aba, `https://${dominio}/`, dominio, achados);
    } catch {
      // sem https (ou certificado quebrado): tenta http, e isso já é um achado
      internos = await lerPagina(aba, `http://${dominio}/`, dominio, achados);
    }
    achados.carregou = true;
    achados.urlFinal = achados.paginasLidas[0] ?? null;
    achados.https = (achados.urlFinal ?? "").startsWith("https://");

    const fila = [...new Set(internos)]
      .filter((l) => PAGINA_DE_CAPTURA.test(new URL(l).pathname) && !/\.(pdf|jpg|png|zip)$/i.test(l))
      .slice(0, MAX_PAGINAS - 1);
    for (const url of fila) {
      await lerPagina(aba, url, dominio, achados).catch(() => null);
    }
  } catch (erro) {
    achados.erro = erro instanceof Error ? erro.message.split("\n")[0] : String(erro);
  } finally {
    await contexto.close().catch(() => null);
    if (!navegadorEmprestado) await navegador.close().catch(() => null);
  }
  achados.temCaptura = achados.formularios.some((f) => f.pedeEmail || f.pedeTelefone);
  return achados;
}
