# raio-x-email

**O que qualquer pessoa consegue ver, de fora, sobre o email do seu domínio e o que o seu site faz com quem chega nele.**

Em português, sem login, sem acessar conta nenhuma, sem mandar nada a ninguém. Você digita o endereço do seu site e recebe, em linguagem de gente, o que está aberto e o que está em ordem.

```
RAIO-X DO EMAIL DE SEUSITE.COM.BR

3 ponto(s) aberto(s), 2 em ordem

O QUE ESTÁ ABERTO
  1. Quem usa o seu endereço não é barrado
     Hoje o seu domínio pede aos provedores de email só para observar. Um email falso
     com o seu endereço não recebe a orientação de ser recusado. Isso não quer dizer
     que alguém já fez isso: é uma porta aberta.
  2. A ferramenta que recebe os seus contatos não aparece no seu domínio
     O formulário do seu site entrega os contatos para o Mailchimp, e o Mailchimp não
     aparece na configuração de email do seu domínio. ...
```

## Por que isso importa

Se você vende pela internet, o seu email é a sua assinatura. Quando o domínio não pede para barrar email falso, qualquer pessoa pode mandar uma mensagem que parece ter saído de você: um boleto, um link de pagamento, um "renove o seu acesso". Quem cai primeiro é justamente quem confia em você, o aluno, o cliente, quem deixou o contato no seu site.

A maioria das pessoas não sabe se isso está aberto no próprio domínio. Este programa responde em segundos.

## Como rodar

Precisa do [Node.js](https://nodejs.org) 20 ou mais novo.

```bash
git clone https://github.com/donatobruggemann/raio-x-email
cd raio-x-email
npm install
npx playwright-core install chromium   # só para a parte do site; uma vez
npm run raio-x -- seusite.com.br
```

Opções:

| comando | o que faz |
|---|---|
| `npm run raio-x -- seusite.com.br` | relatório completo (domínio + site) |
| `npm run raio-x -- seusite.com.br --sem-site` | só o domínio, em 2 segundos, sem abrir navegador |
| `npm run raio-x -- seusite.com.br --json` | os dados brutos, com a prova de cada achado |

## O que ele mede

**No domínio** (consulta pública, a mesma que qualquer servidor de email faz ao receber uma mensagem sua):
- onde fica a sua caixa de entrada;
- quais serviços têm permissão para enviar email em seu nome, e se essa lista está dentro do tamanho que os provedores leem;
- se os seus emails saem assinados (nos lugares mais comuns de assinatura);
- se o domínio pede para barrar email falso com o seu endereço, e se alguém recebe os avisos quando tentam.

**No site** (abrindo como um visitante qualquer, num navegador limpo):
- para qual ferramenta o formulário entrega os contatos (Mailchimp, ActiveCampaign, RD Station, Brevo, Leadlovers e outras);
- qual medição de visita e de anúncio está instalada (Meta, Google, TikTok, Hotjar...);
- onde fica a venda (Hotmart, Kiwify, Eduzz, Greenn...) e se tem botão de WhatsApp;
- e cruza isso com o domínio: a ferramenta que recebe os seus contatos aparece na configuração de email?

Cada ferramenta encontrada vem com a prova, a URL que a denunciou (`--json`).

## Regras que ele segue

- **Nunca afirma o que não mediu.** Consulta que falhou não vira conclusão: o relatório diz que não deu para medir. Domínio que não existe não é acusado de nada.
- **Nunca envia formulário.** O destino do formulário é lido do código da página. Mandar um contato falso para a lista de alguém seria sujar a base dele.
- **Não usa IA para escrever o relatório.** Cada achado tem um texto fixo, sempre o mesmo.
- **Não acessa nada privado.** Só o que o seu domínio e o seu site já mostram para o mundo.

## O que ele não mostra

Se algum email seu já foi falsificado, se os seus envios estão chegando na caixa principal, e como fechar cada ponto. Isso pede acesso às suas contas e muda de provedor para provedor.

Se quiser que alguém faça essa parte por você, me chama no Instagram: [@donatobrug](https://www.instagram.com/donatobrug/).

## Licença

MIT. Use, modifique e distribua à vontade.

Feito por Donato Brug, da Brug Company, que cuida de email de quem vende conhecimento pela internet.
