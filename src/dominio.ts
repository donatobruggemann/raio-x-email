import { resolveTxt, resolveMx, Resolver } from "node:dns/promises";
import type { AuditoriaResultado, ConfigDNS } from "./dominio.types";

/**
 * Leitura do domínio: tudo o que qualquer pessoa consegue ver no DNS público sobre o email de
 * um endereço (caixa de entrada, quem pode enviar em nome dele, assinatura, orientação contra
 * email falso). Não acessa nenhum servidor nem conta do dono, só consulta pública.
 *
 * Regra de certeza: consulta que falhou NÃO vira conclusão. Domínio com leitura incerta sai como
 * "indeterminado", e domínio que não existe não é acusado de nada.
 */

// Seletores DKIM mais usados pelos ESPs que interessam ao pitch.
// A checagem é heurística: DKIM não é enumerável por DNS, só dá pra testar seletor por seletor.
const DKIM_SELECTORS: Record<string, string> = {
  k1: "Klaviyo",
  k2: "Klaviyo",
  k3: "Klaviyo",
  google: "Google Workspace",
  selector1: "Microsoft 365",
  selector2: "Microsoft 365",
  s1: "SendGrid/genérico",
  s2: "SendGrid/genérico",
  hs1: "HubSpot",
  hs2: "HubSpot",
  mandrill: "Mailchimp/Mandrill",
  mte1: "Mailchimp",
  dkim: "genérico",
  default: "genérico",
  mail: "genérico",
  smtp: "genérico",
  cm: "Campaign Monitor",
  sm: "SparkPost",
  zmail: "Zoho",
  pm: "Postmark",
  mailjet: "Mailjet",
  ac: "ActiveCampaign",
  ctct1: "Constant Contact",
};

// Assinaturas de ESP dentro do include: do SPF.
const SPF_ESP_HINTS: Array<[string, string]> = [
  ["klaviyo", "Klaviyo"],
  ["sendgrid", "SendGrid"],
  ["hubspot", "HubSpot"],
  ["mailchimp", "Mailchimp"],
  ["mcsv.net", "Mailchimp"],
  ["activecampaign", "ActiveCampaign"],
  ["amazonses", "Amazon SES"],
  ["mailgun", "Mailgun"],
  ["postmark", "Postmark"],
  ["sparkpost", "SparkPost"],
  ["klclick", "Klaviyo"],
  ["_spf.google.com", "Google Workspace"],
  ["protection.outlook", "Microsoft 365"],
  ["zoho", "Zoho"],
  ["brevo", "Brevo"],
  ["sendinblue", "Brevo"],
  ["mailjet", "Mailjet"],
  ["omnisend", "Omnisend"],
  ["attentivemobile", "Attentive"],
  ["salesforce", "Salesforce"],
];

/**
 * Cria um resolver DNS com nameservers públicos.
 * Evita instabilidade do DNS do WSL.
 */
function criarResolver(timeoutMs: number): Resolver {
  const resolver = new Resolver();
  resolver.setServers(["1.1.1.1", "8.8.8.8", "9.9.9.9"]);
  // Node.js Resolver não expõe timeout diretamente, mas as operações herdam do sistema
  // Vamos usar Promise.race com timeout manual onde precisarmos
  return resolver;
}

/**
 * Consulta registros TXT, distinguindo AUSENTE de INDETERMINADO.
 *
 * Um timeout de DNS devolve a mesma lista vazia que um registro que de fato não existe.
 * Tratar os dois como iguais faz o auditor acusar "SPF ausente" num domínio que tem SPF —
 * e uma acusação falsa na primeira linha do email destrói a credibilidade da oferta.
 *
 * Por isso: falha de rede vira `state.dns_indeterminado = true`, e quem lê decide não acusar.
 */
async function lerRecordsTxt(
  resolver: Resolver,
  name: string,
  state: AuditoriaResultado,
  timeoutMs: number,
  maxTentativas: number
): Promise<string[]> {
  let ultimoErro: Error | null = null;

  for (let tentativa = 0; tentativa < maxTentativas; tentativa++) {
    try {
      // Aplicar timeout manual usando Promise.race
      const timeoutPromise = new Promise<string[][]>((_, reject) =>
        setTimeout(() => reject(new Error("DNS timeout")), timeoutMs)
      );

      const resultado: string[][] = await Promise.race([
        resolver.resolveTxt(name),
        timeoutPromise,
      ]);

      // Concatenar strings de registros TXT longos (até 255 bytes cada)
      return resultado.map((parts) => parts.join(""));
    } catch (err) {
      ultimoErro = err instanceof Error ? err : new Error(String(err));
      const msg = ultimoErro.message.toLowerCase();

      // Resposta autoritativa: o registro realmente não existe. Isso é um fato.
      if (msg.includes("enotfound") || msg.includes("enodata")) {
        return [];
      }

      // Falha de transporte: não sabemos nada sobre o registro. Tenta de novo.
      if (tentativa < maxTentativas - 1) {
        await new Promise((r) => setTimeout(r, 400 * (tentativa + 1)));
      }
    }
  }

  // Após todas as tentativas, falha persistente é indeterminado
  state.dns_indeterminado = true;
  state.dns_falhas.push(`${name}/TXT: ${ultimoErro?.message || "desconhecido"}`);
  return [];
}

/**
 * Verifica se um registro de um tipo específico existe.
 */
async function temRecord(
  resolver: Resolver,
  name: string,
  rtype: "MX" | "TXT",
  timeoutMs: number
): Promise<boolean> {
  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), timeoutMs)
    );

    const promise =
      rtype === "MX"
        ? resolver.resolveMx(name)
        : resolver.resolveTxt(name);

    await Promise.race([promise, timeoutPromise]);

    return true;
  } catch {
    return false;
  }
}

/**
 * Aceita URL completa, com www, com caminho, e devolve o domínio registrável.
 */
export function extrairDominio(rawOuTexto: string): string | null {
  let d = (rawOuTexto || "").trim().toLowerCase();

  if (!d) {
    return null;
  }

  d = d.replace(/^https?:\/\//, "");
  d = d.split("/")[0]?.split("?")[0]?.split("#")[0]?.split(":")[0] || "";
  d = d.replace(/^www\./, "");

  return d && d.includes(".") ? d : null;
}

/**
 * Conta os mecanismos SPF que geram consulta DNS. A RFC 7208 estoura em 10.
 */
function contarLookupsSPF(spf: string): number {
  const matches = spf.match(/\b(include|a|mx|ptr|exists|redirect)[:=]?/g);
  return matches ? matches.length : 0;
}

/**
 * Lê o domínio e devolve o que foi medido, a nota e a gravidade.
 */
/**
 * O domínio existe no DNS? Pergunta pelo NS, que todo domínio registrado e delegado tem.
 *
 * Devolve "inexistente" só diante de resposta autoritativa de que o nome não existe.
 * Falha de rede devolve "incerto", porque não saber não é o mesmo que não existir.
 */
async function dominioExiste(
  dominio: string,
  timeoutMs: number,
): Promise<"sim" | "nao" | "incerto"> {
  const resolver = criarResolver(timeoutMs);
  try {
    const ns = await resolver.resolveNs(dominio);
    return ns.length > 0 ? "sim" : "nao";
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    if (msg.includes("enotfound") || msg.includes("nxdomain")) return "nao";
    // ENODATA no NS é estranho mas não prova ausência do domínio: tenta o SOA antes de decidir.
    try {
      await resolver.resolveSoa(dominio);
      return "sim";
    } catch (err2) {
      const msg2 = (err2 instanceof Error ? err2.message : String(err2)).toLowerCase();
      if (msg2.includes("enotfound") || msg2.includes("nxdomain")) return "nao";
      return "incerto";
    }
  }
}

export async function auditarDominio(
  dominio: string,
  config?: ConfigDNS
): Promise<AuditoriaResultado> {
  const timeoutMs = config?.timeoutMs ?? 5000;
  const maxTentativas = config?.maxTentativas ?? 3;

  const resolver = criarResolver(timeoutMs);

  /**
   * Antes de qualquer leitura, confirma que o DOMÍNIO existe.
   *
   * Sem isto, um domínio vencido responde NXDOMAIN em cada consulta e o código lê isso como
   * "o registro não existe", e o relatório acusaria falta de proteção num domínio que sequer
   * está no ar.
   */

  const resultado: AuditoriaResultado = {
    domain: dominio,
    mx: "",
    mx_provider: "",
    esp: "",
    spf: "",
    spf_policy: "",
    spf_lookups: 0,
    dmarc: "",
    dmarc_policy: "",
    dmarc_pct: "",
    dmarc_rua: false,
    dkim_selectors: "",
    bimi: false,
    mta_sts: false,
    score: 0,
    findings: [],
    severity: "ok",
    dns_indeterminado: false,
    dns_falhas: [],
    dominio_inexistente: false,
  };

  const existe = await dominioExiste(dominio, timeoutMs);

  if (existe === "nao") {
    // Encerra aqui. Não há o que auditar num domínio que não está no ar, e qualquer
    // achado a partir daqui seria acusação inventada.
    resultado.dominio_inexistente = true;
    resultado.findings = ["O domínio não existe no DNS (vencido, errado ou nunca registrado)"];
    resultado.severity = "indeterminado";
    resultado.score = 0;
    return resultado;
  }

  if (existe === "incerto") {
    resultado.dns_indeterminado = true;
    resultado.dns_falhas.push(`${dominio}/NS: não consegui confirmar se o domínio existe`);
  }

  // ---- MX -------------------------------------------------------------
  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), timeoutMs)
    );

    const mxRecords: Array<{ priority: number; exchange: string }> = await Promise.race([
      resolver.resolveMx(dominio),
      timeoutPromise,
    ]);

    if (mxRecords && mxRecords.length > 0) {
      const sorted = mxRecords.sort((a, b) => a.priority - b.priority);
      const hosts = sorted.map((m) => m.exchange.toLowerCase().replace(/\.$/, ""));
      resultado.mx = hosts[0] || "";

      const blob = hosts.join(" ");
      if (blob.includes("google")) {
        resultado.mx_provider = "Google Workspace";
      } else if (blob.includes("outlook") || blob.includes("microsoft")) {
        resultado.mx_provider = "Microsoft 365";
      } else if (blob.includes("zoho")) {
        resultado.mx_provider = "Zoho";
      } else if (hosts.length > 0) {
        resultado.mx_provider = "outro/próprio";
      }
    }
  } catch {
    resultado.findings.push("sem MX (domínio não recebe email)");
  }

  // ---- SPF ------------------------------------------------------------
  const spfRecords = await lerRecordsTxt(resolver, dominio, resultado, timeoutMs, maxTentativas);
  const spf = spfRecords.find((t) => t.toLowerCase().startsWith("v=spf1")) || "";
  resultado.spf = spf;

  if (!spf) {
    if (resultado.dns_indeterminado) {
      resultado.findings.push("SPF não verificado (consulta DNS falhou)");
    } else {
      resultado.findings.push("SPF ausente");
    }
  } else {
    resultado.spf_lookups = contarLookupsSPF(spf);

    if (spf.includes("+all")) {
      resultado.spf_policy = "+all";
      resultado.findings.push(
        "SPF com +all (autoriza qualquer servidor a enviar pelo domínio)"
      );
    } else if (spf.includes("-all")) {
      resultado.spf_policy = "-all";
    } else if (spf.includes("~all")) {
      resultado.spf_policy = "~all";
    } else if (spf.includes("?all")) {
      resultado.spf_policy = "?";
      resultado.findings.push("SPF termina em ?all (neutro, não protege)");
    } else {
      resultado.spf_policy = "sem all";
      resultado.findings.push("SPF sem mecanismo 'all' no fim");
    }

    if (resultado.spf_lookups > 10) {
      resultado.findings.push(
        `SPF com ~${resultado.spf_lookups} lookups (limite RFC é 10, acima disso falha)`
      );
    }

    const spfLower = spf.toLowerCase();
    const esps = new Set<string>();
    for (const [key, name] of SPF_ESP_HINTS) {
      if (spfLower.includes(key)) {
        esps.add(name);
      }
    }
    resultado.esp = Array.from(esps).sort().join(", ");
  }

  // ---- DMARC ----------------------------------------------------------
  const dmarcRecords = await lerRecordsTxt(
    resolver,
    `_dmarc.${dominio}`,
    resultado,
    timeoutMs,
    maxTentativas
  );
  const dmarc = dmarcRecords.find((t) => t.toLowerCase().startsWith("v=dmarc1")) || "";
  resultado.dmarc = dmarc;

  if (!dmarc) {
    if (resultado.dns_indeterminado) {
      resultado.findings.push("DMARC não verificado (consulta DNS falhou)");
    } else {
      resultado.findings.push("DMARC ausente (nada impede spoofing do domínio)");
    }
  } else {
    const policyMatch = dmarc.match(/\bp\s*=\s*(none|quarantine|reject)/i);
    resultado.dmarc_policy = policyMatch
      ? (policyMatch[1].toLowerCase() as "none" | "quarantine" | "reject")
      : "?";

    resultado.dmarc_rua = /rua=/i.test(dmarc);

    const pctMatch = dmarc.match(/\bpct\s*=\s*(\d+)/);
    resultado.dmarc_pct = pctMatch ? pctMatch[1] : "100";

    if (resultado.dmarc_policy === "none") {
      resultado.findings.push(
        "DMARC em p=none (monitora mas não bloqueia nada)"
      );
    }

    if (!resultado.dmarc_rua) {
      resultado.findings.push(
        "DMARC sem rua= (não recebe relatório, opera às cegas)"
      );
    }

    if (
      resultado.dmarc_pct !== "100" &&
      (resultado.dmarc_policy === "quarantine" || resultado.dmarc_policy === "reject")
    ) {
      resultado.findings.push(
        `DMARC aplicado a só ${resultado.dmarc_pct}% do tráfego`
      );
    }
  }

  // ---- DKIM (heurística por seletor) ----------------------------------
  const foundDkim: string[] = [];
  for (const [seletor, provider] of Object.entries(DKIM_SELECTORS)) {
    const dkimRecords = await lerRecordsTxt(
      resolver,
      `${seletor}._domainkey.${dominio}`,
      resultado,
      timeoutMs,
      maxTentativas
    );
    if (dkimRecords.length > 0) {
      foundDkim.push(`${seletor}(${provider})`);
      if (foundDkim.length >= 4) {
        break;
      }
    }
  }

  resultado.dkim_selectors = foundDkim.join(", ");

  if (foundDkim.length === 0) {
    resultado.findings.push(
      "DKIM não encontrado nos seletores comuns (verificar manualmente)"
    );
  }

  if (foundDkim.length > 0 && !resultado.esp) {
    const providers = new Set<string>();
    for (const item of foundDkim) {
      const match = item.match(/\(([^)]+)\)/);
      if (match) {
        providers.add(match[1]);
      }
    }
    resultado.esp = Array.from(providers).sort().join(", ");
  }

  // ---- Sinais de maturidade -------------------------------------------
  const bimiRecords = await lerRecordsTxt(
    resolver,
    `default._bimi.${dominio}`,
    resultado,
    timeoutMs,
    maxTentativas
  );
  resultado.bimi = bimiRecords.length > 0;

  const mtaStsRecords = await lerRecordsTxt(
    resolver,
    `_mta-sts.${dominio}`,
    resultado,
    timeoutMs,
    maxTentativas
  );
  resultado.mta_sts = mtaStsRecords.length > 0;

  // ---- Score ----------------------------------------------------------
  let score = 0;
  if (resultado.spf) {
    score += 20;
    if (resultado.spf_policy === "-all" || resultado.spf_policy === "~all") {
      score += 10;
    }
    if (resultado.spf_lookups <= 10) {
      score += 5;
    }
  }
  if (resultado.dkim_selectors) {
    score += 20;
  }
  if (resultado.dmarc) {
    score += 15;
    if (resultado.dmarc_policy === "quarantine") {
      score += 10;
    } else if (resultado.dmarc_policy === "reject") {
      score += 15;
    }
    if (resultado.dmarc_rua) {
      score += 5;
    }
  }
  if (resultado.bimi) {
    score += 5;
  }
  if (resultado.mta_sts) {
    score += 5;
  }
  resultado.score = Math.min(score, 100);

  // ---- Gravidade --------------------------------------------------------
  // Leitura incerta não vira conclusão: melhor dizer "não deu pra medir" do que errar.
  if (resultado.dns_indeterminado) {
    resultado.severity = "indeterminado";
    resultado.score = 0;
    return resultado;
  }
  if (!resultado.dmarc || resultado.spf.includes("+all") || !resultado.spf) resultado.severity = "alta";
  else if (resultado.dmarc_policy === "none" || resultado.spf_lookups > 10) resultado.severity = "média";
  else if (!resultado.dmarc_rua) resultado.severity = "baixa";
  else resultado.severity = "ok";

  return resultado;
}
