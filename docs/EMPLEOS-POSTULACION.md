# Postulaciones de Empleos con hoja de vida adjunta

## Estado en producción

El formulario envía postulaciones de verdad desde
<https://paginaweb-beta-coral.vercel.app/empleos/>. Aquí no va ningún valor de
clave: solo nombres y dónde vive cada cosa.

| Pieza | Configuración |
| --- | --- |
| Correo | Cuenta de Resend registrada con **ghsantiagodetunja@gmail.com**, clave en `RESEND_API_KEY`. Remitente `onboarding@resend.dev`: **dstunja.com NO está verificado** (comprobado por DNS el 30/09/2026 con `npm run verificar:correo`: no hay SPF, ni DKIM, ni DMARC, ni MX). `EMPLEOS_DESTINO` y `EMPLEOS_REMITENTE` **sí están cargadas** en Production y sus valores no se han leído; lo comprobado es que Resend **acepta** el envío hacia ese destino (ver «El orden importa: primero el remitente, después el destino») |
| Antirrobots | Cloudflare Turnstile, widget **«DST web»**, modo **Non-interactive**, compartido con PQRS. Hostnames: `dstunja.com`, `paginaweb-beta-coral.vercel.app`, `vercel.app` y `localhost` |
| Hoja de vida | Adjunta al correo; no se guarda en ningún sitio (tampoco en el Blob store de PQRS) |
| Cuenta de PQRS | Es otra: informacioncomercialdst@gmail.com, con `PQRS_RESEND_API_KEY`. No se mezclan, porque con el remitente de pruebas cada cuenta solo entrega a su titular |

Variables que usa Empleos y su estado en Vercel (Production):

| Variable | Estado |
| --- | --- |
| `RESEND_API_KEY` | Cargada (cuenta de ghsantiagodetunja@gmail.com) |
| `PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET` | Cargadas (widget «DST web») |
| `EMPLEOS_DESTINO`, `EMPLEOS_REMITENTE` | **Cargadas las dos** en Production desde el 14/09/2026 (`vercel env ls production`). Son opcionales en el código, pero no están ausentes: no se puede razonar como si valieran sus valores por defecto. Para leerlas: `vercel env pull`. Lo comprobado es que la combinación funciona, no cuál es |
| `BLOB_READ_WRITE_TOKEN` | La pone Vercel al conectar el store `pqrs-adjuntos`. **Ahora es obligatoria también para Empleos**: es la red de seguridad que guarda la hoja de vida si el correo no sale |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | **Faltan**. Sin ellas el límite vive en la memoria de cada instancia, y por eso en ese modo es más tolerante: 20 cada 10 minutos, contando por IP y huella del archivo |

Al candidato no le llega ningún correo, y eso no depende del dominio: la
confirmación es la pantalla. Lo que desbloquea verificar dstunja.com en Resend
(remitente propio, una sola cuenta para los dos formularios) y qué registros DNS
pide está en «Pendiente: verificar dstunja.com en Resend», en
docs/PQRS-ADJUNTOS.md.

## Qué hace

El formulario de `/empleos/` **envía la postulación desde la página**, sin abrir el
gestor de correo del candidato, y lleva la **hoja de vida adjunta**. Una función de
Vercel (`POST /api/empleos/postular`) recibe el formulario como multipart, lo
valida, comprueba que no es un robot y manda **un** correo por Resend a Talento
Humano con los datos en el cuerpo y el archivo adjunto.

| | Empleos |
| --- | --- |
| Cómo sale | `POST /api/empleos/postular` (multipart/form-data) |
| Destino | `EMPLEOS_DESTINO`; por defecto `contactoEmpleo.email` de `src/data/vacantes.ts` (`ghsantiagodetunja@gmail.com`) |
| Remitente | `EMPLEOS_REMITENTE`; por defecto el de PQRS (`PQRS_REMITENTE` o `onboarding@resend.dev`) |
| Clave de Resend | `RESEND_API_KEY`, de la cuenta de Resend de Empleos (distinta de la de PQRS) |
| Asunto | `Postulación: {cargo} – {nombre}` |
| Responder desde la bandeja | Va al candidato (`replyTo`) |
| Hoja de vida | **Obligatoria**, PDF, DOC o DOCX, **máximo 3 MB**, adjunta al correo |
| Dónde se guarda el archivo | **En ningún sitio**: vive en la memoria de la función lo que dura la petición |
| Antispam | Campo trampa (honeypot) + límite por IP (5 cada 10 min) + Turnstile |
| Autorización Ley 1581 | Casilla obligatoria, validada también en el servidor |
| Correos que salen | 1 (a Talento Humano). Al candidato no: la confirmación es la pantalla |
| Número de radicado | No |
| Funciona en GitHub Pages | No. Se explica en pantalla, con el código `E-SIN-API`, y se ofrece WhatsApp |

Reutiliza la infraestructura de PQRS: el mismo proveedor (Resend), el mismo
Turnstile, el mismo limitador por IP (`src/lib/pqrs/limite-tasa.ts`, con Upstash
si está configurado) y las mismas reglas de archivos (`src/lib/adjuntos.ts`). La
**cuenta** de Resend sí es otra: sin dominio verificado cada cuenta solo entrega a
su titular, así que Empleos usa `RESEND_API_KEY` y PQRS `PQRS_RESEND_API_KEY`.

## Por qué el archivo SÍ pasa por la función (y en PQRS no)

En PQRS los soportes van del navegador a Vercel Blob y la función solo firma el
permiso, porque hay que **conservarlos** y porque una función de Vercel rechaza
cuerpos de más de **4,5 MB**.

Aquí no hay nada que conservar: la hoja de vida se adjunta al correo y se
descarta. Pasarla por el Blob sería subirla para bajarla, adjuntarla y borrarla.
Por eso viaja dentro del multipart, y por eso el tope es **4 MB y no 5**: con
4 MB de archivo más los campos de texto queda margen bajo el límite de 4,5 MB.
Si algún día hiciera falta admitir archivos mayores, el camino es el de PQRS
(subida directa al Blob y borrado después de enviar).

```
navegador                              función                      Resend
    |                                     |                            |
    |-- POST /api/empleos/postular ------>|                            |
    |   multipart: campos + hoja de vida  | campo trampa vacío?        |
    |   + turnstileToken                  | valida campos              |
    |                                     | valida bytes del archivo   |
    |                                     | límite por IP              |
    |                                     | Turnstile                  |
    |                                     |-- correo + adjunto ------->|
    |<-- { ok: true } --------------------|                            |
```

## Endpoint

### `POST /api/empleos/postular`

Cuerpo `multipart/form-data`:

| Campo | Tipo | Reglas |
| --- | --- | --- |
| `nombre` | texto | obligatorio, 3-150 |
| `correo` | texto | obligatorio, formato de correo, hasta 150 |
| `telefono` | texto | obligatorio, 7-15 dígitos (el `57` inicial no cuenta), hasta 30 |
| `cargo` | texto | obligatorio; una de las vacantes abiertas (las de Control360 vía `C360_VACANTES_URL`, o las de `src/data/vacantes.ts` si no se leyeron) o `Otro / hoja de vida espontánea` |
| `experiencia` | texto | **opcional**, hasta 3000 |
| `autorizacion` | `si` / `on` / `true` | obligatoria (Ley 1581 de 2012) |
| `hoja-de-vida` | archivo | obligatoria; `.pdf`, `.doc` o `.docx`; hasta 4 MB; el contenido debe corresponder a la extensión |
| `sitio-web` | texto | campo trampa: debe llegar **vacío** |
| `turnstileToken` | texto | token del widget |

La lista de cargos está en `src/lib/empleos/cargos.ts` y la leen **el `<select>` y
el servidor**: un cargo que se cierre desaparece de los dos a la vez, y nadie puede
postularse a uno inventado mandando el multipart a mano. Las vacantes salen de
`src/lib/empleos/vacantes-fuente.ts`: Control360 (`C360_VACANTES_URL`, leída en
el build) y, si falla o no está, `src/data/vacantes.ts`. El servidor acepta además
los cargos de la lista estática, por si Control360 cambió entre el build y la
postulación.

Orden de las comprobaciones (`src/lib/empleos/postular.ts`): forma del cuerpo →
campo trampa → campos y bytes del archivo → límite por IP → Turnstile → correo.
Lo barato y local va primero; un `400` llega **sin gastar un token de Turnstile**,
que es de un solo uso.

Respuestas:

- `200` → `{ ok: true }`. También cuando el campo trampa venía relleno: al robot no
  se le dice qué lo delató y no se manda nada.
- `400` → `{ ok: false, errores: [...] }`. Devuelve **todos** los errores, no solo
  el primero: campos mal, archivo rechazado, cuerpo que no es multipart.
- `200` → `{ ok: true, referencia: 'EMP-…' }` cuando el correo **no** salió pero la
  postulación quedó guardada en el Blob. La referencia se le enseña al candidato.
- `403` → Turnstile no pasó (o no hay `TURNSTILE_SECRET`: falla cerrado). El
  navegador reenvía una vez con `sin_verificar` antes de rendirse.
- `429` → se pasó del límite. Cuál es depende de si la postulación venía
  verificada y de si hay Upstash (ver «Variables de entorno»).
- `500` → el correo no salió **y no se pudo guardar nada**. Es el único desenlace
  que pierde una postulación, y solo ocurre si falta `BLOB_READ_WRITE_TOKEN` o si
  el store falla al escribir.

Todos los errores llevan además un `codigo` corto (`E-DATOS`, `E-LIMITE`,
`E-CORREO`, `T-…`) que el formulario enseña en pantalla. El motivo técnico (una
clave mal puesta, el dominio del remitente sin verificar en Resend) se queda en
el registro de Vercel y nunca viaja en la respuesta.

Ese `500` dejó de ser el caso común: antes cualquier fallo de Resend acababa
ahí, y el navegador abría el gestor de correo. Ahora el correo se reintenta tres
veces y, si no sale, la hoja de vida se guarda (ver «La red de seguridad»).

## El correo que llega a Talento Humano

- Asunto `Postulación: {cargo} – {nombre}`, para filtrar y encaminar sin abrirlo.
- `replyTo` al correo del candidato: **responder** desde la bandeja le escribe a él.
- En el cuerpo, el **teléfono es un enlace `tel:`** (en formato E.164, con el `+57`
  puesto si no venía) y el **correo un `mailto:`**, para contestar desde el celular
  con un toque.
- El texto de experiencia, si lo escribió; si no, se dice que está todo en la hoja
  de vida.
- La hoja de vida **adjunta**, con el nombre saneado (`hoja_de_vida.pdf`) y el MIME
  deducido del contenido, no del que declaró el navegador.
- Versión HTML y versión en texto plano.

No hay correo de confirmación al candidato: sin radicado ni plazo legal, un
segundo correo solo llenaría su bandeja. La confirmación es la pantalla.

## La hoja de vida se revisa dos veces

`src/lib/empleos/hoja-de-vida.ts` no toca el DOM ni el entorno, y lo importan el
navegador y el servidor sin cambiar una línea. Delega en `validarArchivo` de
`src/lib/adjuntos.ts`: peso, doble extensión (`hoja.exe.pdf`), saneado del
nombre y **bytes mágicos** (`%PDF`, contenedor OLE2 para `.doc`, ZIP con carpeta
`word/` para `.docx`).

**Decide el contenido, no el nombre** (`confiarEnElContenido`, 30·10·2026). Si
los bytes son de un PDF, DOC o DOCX, el archivo se acepta aunque el nombre llegue
sin extensión o con otra, y se le pone la que le corresponde —que es la que
viaja al adjunto del correo y a Control360—. Antes la extensión del nombre se
comprobaba PRIMERO y un nombre sin extensión se rechazaba con «formato no
permitido» sin llegar a mirar los bytes: ver más abajo [Por qué desde el celular
no se podía adjuntar](#por-qué-desde-el-celular-no-se-podía-adjuntar). No se
pierde nada de seguridad, porque lo que se exigía de verdad era el contenido y se
sigue exigiendo; la doble extensión sospechosa se sigue rechazando por el nombre.
Los soportes de PQRS NO llevan esa opción: allí nombre y contenido tienen que
coincidir.

- En el navegador (`src/components/FormularioEmpleo.astro`), al elegir el archivo:
  el rechazado se saca del input, se explica por qué, y el motivo queda como
  validez personalizada del campo para que `reportValidity()` frene el envío con
  ese mensaje. El aceptado se enseña con su nombre y su peso. El texto de ayuda
  dice el tope **antes** de elegir: «PDF, DOC o DOCX, máximo 3 MB.».
- En el servidor, sobre los bytes recibidos. La validación del navegador se
  salta con las DevTools abiertas; la que vale es esta.

## Por qué desde el celular no se podía adjuntar

El 30 de octubre de 2026 nos reportaron que **los candidatos no podían subir su
hoja de vida desde ningún teléfono**, y que desde el PC el mismo formulario
funcionaba. Dos personas lo intentaron ese día y ninguna lo consiguió. Las
postulaciones que no llegan a enviarse no dejan rastro en los registros de Vercel
—se caen en el navegador, antes del `fetch`—, así que el diagnóstico salió de
mirar qué hace distinto un teléfono. Son tres cosas, y estaban las tres:

1. **El navegador de WhatsApp no abre el selector de archivos.** Las vacantes
   circulan por WhatsApp: el flyer con el enlace, el candidato lo abre DENTRO de
   WhatsApp. Eso no es Chrome, es un WebView, y un WebView solo abre el selector
   si la aplicación anfitriona implementó `onShowFileChooser`. Varias no lo
   hacen: se toca «Hoja de vida» y **no pasa nada**. Ni selector, ni error.
   Desde la página no hay forma de forzarlo, así que lo que se hace es avisar y
   dar salida: `src/lib/navegador-incrustado.ts` detecta el WebView por el
   `User-Agent` (en Android, el token `wv`, que es lo único que delata a
   WhatsApp; las demás aplicaciones se firman con su nombre) y el formulario
   enseña una franja con «Abrir en Chrome» (un enlace `intent://`, solo en
   Android), «Copiar el enlace» y «Mandarla por WhatsApp». El aviso se va solo en
   cuanto hay un archivo adjunto. Hay además una red por si el `User-Agent` no
   delata nada: si al tocar el campo la página sigue delante y sin archivo
   pasados 3 segundos, el selector no abrió y sale la misma franja (solo con
   pantalla táctil; en el PC el diálogo no siempre cambia la visibilidad).
2. **El nombre que entrega el selector de Android no trae extensión.** El nombre
   lo pone el proveedor del archivo (Drive, Descargas, Documentos de WhatsApp,
   Gmail) y muchas veces es «Documento» o «hoja de vida» a secas. Con la
   extensión decidiendo primero, eso era «formato no permitido» para un PDF
   perfectamente válido. Ahora manda el contenido (sección anterior).
3. **El `accept` escondía el archivo en el selector.** Chrome de Android traduce
   cada extensión del `accept` a un tipo MIME y le pide al selector que oculte
   todo lo demás; un archivo cuyo proveedor no declara bien el tipo salía en
   gris o no salía. El `accept` lleva ahora las extensiones **y** sus MIME **y**
   `application/octet-stream`, que es lo que declaran los gestores de archivos
   que no saben de qué tipo es. Es solo un filtro de comodidad: quien decide si
   vale es la validación, en el navegador y otra vez en el servidor.

Dos dead ends más que se cerraron con esto, porque la persona se quedaba sin
saber qué pasaba:

- **Leer el archivo puede fallar** (uno de Drive que no está descargado, uno que
  la aplicación de origen movió). La excepción subía sin que nadie la atendiera:
  no se pintaba ni el nombre ni un error. Ahora se explica y se pide descargarlo
  al teléfono.
- **Sin hoja de vida, el motivo se escribe en la página**, no solo en la burbuja
  de `reportValidity()`: en el celular esa burbuja se va en dos segundos, o no se
  pinta, o queda fuera de la pantalla, y se pulsa «Enviar postulación» y
  aparentemente no pasa nada.
- **Con el archivo rechazado aparece la salida por WhatsApp junto al campo.**
  Antes solo estaba abajo, en el aviso de error del envío, y a ese aviso no llega
  quien no consigue pasar del campo.

Lo que **no** cambió: una hoja de vida sigue siendo un documento, no una foto. Un
JPG o un PNG se rechazan, pero el mensaje ya dice «es una foto, no un documento»
y cómo arreglarlo, en vez de hablar de formatos no permitidos.

## Seguridad

- **Campo trampa.** Un `<input name="sitio-web">` fuera de la pantalla, fuera del
  orden de tabulación y oculto a los lectores de pantalla. Una persona no lo ve;
  un robot que rellena todo lo llena. Si llega con algo: `200` y nada más.
- **Límite por IP**, el mismo de PQRS (`limitar`, prefijo `empleos:postular`).
  Con Upstash es compartido entre instancias; sin él es un contador en memoria
  que frena un script torpe, no un ataque (ver `docs/PQRS-ADJUNTOS.md`).
- **Turnstile**, el mismo widget en modo `interaction-only`. Sin
  `TURNSTILE_SECRET` el servidor rechaza: no se deja pasar por defecto.
- **El archivo no se guarda.** Ni en Blob, ni en disco, ni en registro. Solo va
  en el correo.
- **Lo escrito se escapa** antes de meterlo en el HTML del correo, y el nombre
  del archivo viaja saneado (`sanitizarNombre`).
- **La IP no se guarda**: solo se usa para el límite de tasa y para Turnstile.

## Turnstile: cuando Cloudflare pide marcar la casilla

En producción el widget «DST web» está en modo **Non-interactive**: Cloudflare no
pide marcar ninguna casilla y, con `appearance: 'interaction-only'`, no se ve
nada. Lo que sigue es la red por si el modo cambiara o Cloudflare decidiera pedir
interacción, que fue lo que pasó antes de configurarlo así.

El widget va en modo `interaction-only`: normalmente no se ve, pero Cloudflare
puede decidir, **después de pulsar Enviar**, que hace falta marcar la casilla
«Verifique que es un ser humano». Entonces:

- Sale el aviso «Falta un paso: marca la casilla de verificación de seguridad que
  aparece arriba…» y la casilla se lleva a la vista.
- La espera **no vence** mientras la persona la marca. Hay un tope de 30 s para
  cuando Cloudflare resuelve solo, y de 5 minutos a partir de que aparece la
  casilla; antes de eso suele avisar el propio Cloudflare con `timeout-callback`.
- Al marcarla llega el token y la postulación sale hacia la función.

Si la verificación **falla o caduca**, la librería reintenta sola una vez con el
widget reiniciado. Si el segundo intento tampoco pasa —o si el script de
Cloudflare ni siquiera carga, por un bloqueador o una red corporativa— la
postulación **sale igual**, marcada `sin_verificar`. Lo que ya no pasa, en
ninguno de esos casos, es que el candidato se quede sin postular.

### Y si el reto no se puede resolver, la postulación sale igual

Hay navegadores en los que el reto de Cloudflare **no corre**: el WebView de
WhatsApp o de Instagram, un teléfono viejo, una red corporativa, un bloqueador.
Ahí no hay nada que la persona pueda hacer, y dejarla fuera es perder a un
candidato real. Por eso:

1. `tokenTurnstile()` **reintenta una vez sola**, reiniciando el widget. Un
   600010 esporádico —son fallos de ejecución del reto en el navegador— suele
   pasar al segundo intento.
2. Si tampoco pasa, el formulario manda la postulación **sin token y con la
   marca `sin_verificar`**, más el código del fallo en `turnstileCodigo`.
3. El servidor la acepta por una puerta más estrecha: `LIMITE_SIN_VERIFICAR`,
   tres cada treinta minutos por IP y huella del archivo.
4. El correo llega con **`[SIN VERIFICAR]` delante del asunto** y un aviso en el
   cuerpo, para que Talento Humano lo lea con criterio.

Un `403` del servidor (token caducado, ya usado, o dominio sin autorizar) se
reenvía **una vez** de la misma manera. Para la persona, un token que el servidor
rechaza es indistinguible de una página rota.

**Esto es un intercambio consciente, y conviene tenerlo presente:** esa puerta
también la puede usar un robot, porque le basta con no mandar token. Lo que
queda filtrando es el campo trampa, la validación de los campos, la firma real
del archivo y ese límite. Si un día empieza a entrar basura, el número que hay
que mirar es el de `aceptada:sin-verificar` en el registro de Vercel, y la
decisión a tomar es si se cierra esa puerta o se aprieta el límite.

### El fallo que hubo en producción

Antes el tope de 30 s corría también mientras la casilla estaba en pantalla, y
cualquier fallo de Turnstile se trataba como «no hay función». El resultado: la
casilla aparecía, a los 30 s el formulario abría el `mailto:` y **nunca llamaba a
`/api/empleos/postular`**. Por eso ni los logs de Vercel ni los de Resend
registraban nada aunque las variables estuvieran bien. El arreglo vive en
`src/lib/turnstile-cliente.ts`, que comparten los tres formularios, así que PQRS
también deja de cortar la espera mientras se marca la casilla.

Para diagnosticar: si el formulario cae al correo y en Vercel no aparece ninguna
petición a la función, el problema está en el navegador, antes del `fetch`. La
consola del navegador muestra `[turnstile] error <código>` o
`[empleos] verificación de seguridad: <motivo>`. El código `110200` significa que
el dominio desde el que se sirve la página no está autorizado en el widget de
Cloudflare. Hoy «DST web» autoriza `dstunja.com`, `paginaweb-beta-coral.vercel.app`,
`vercel.app` y `localhost`; un dominio nuevo se añade en **Turnstile → «DST web» →
Hostnames**. `vercel.app` cubre cualquier subdominio de Vercel, también ajenos:
si no se usan las vistas previas de rama, conviene quitarlo.

## Ya no hay respaldo por `mailto:`

**Se quitó, y quitarlo fue el objetivo de todo este trabajo.** La página abría el
gestor de correo del candidato con sus datos en el cuerpo y le pedía adjuntar la
hoja de vida **otra vez, a mano**, porque un `mailto:` no puede llevar archivos.
En el celular, y sobre todo dentro del navegador de WhatsApp, muchas veces no se
abría nada: la persona se quedaba mirando un aviso que hablaba de un correo que
nunca existió, su postulación no llegaba y **no quedaba registrada en ningún
sitio**. Ni un log en Vercel, ni una línea en Resend.

Hoy, cuando algo falla:

| Qué pasó | Qué ve el candidato | Código |
| --- | --- | --- |
| Campos mal (`400`) | El motivo, campo por campo | `E-DATOS` |
| Límite por IP (`429`) | Cuánto esperar | `E-LIMITE` |
| Turnstile rechazado dos veces (`403`) | El motivo | `T-<código de Cloudflare>` |
| El correo no salió y no había Blob (`500`) | «Inténtalo de nuevo en unos minutos» | `E-CORREO` |
| El espejo estático sin funciones | «No está disponible en esta dirección» | `E-SIN-API` |
| La red caída | «Revisa tu conexión» | `E-RED` |
| El correo no salió pero **se guardó** (`200`) | «Postulación enviada» + una referencia `EMP-…` | — |

El **código corto** no es para el candidato, que no puede hacer nada con él: es
para nosotros. Quien manda una captura de pantalla por WhatsApp nos está diciendo
con ese código si el problema fue el dominio sin autorizar en Cloudflare
(`T-110200`), el reto que no corre en su navegador (`T-600010`) o el correo
(`E-CORREO`), sin tener que pedirle que abra ninguna consola.

**WhatsApp aparece solo dentro del aviso de error**, con un mensaje prellenado que
dice que ya intentó postularse. Antes estaba siempre al lado del botón de enviar
y competía con el envío de verdad: por WhatsApp la hoja de vida llega como un
archivo suelto, sin cargo ni autorización de datos, y alguien tiene que
transcribirlo a mano.

## La red de seguridad: si el correo no sale, la hoja de vida se guarda

El orden completo cuando llega una postulación válida:

1. **El correo se intenta tres veces**, con pausas de 500 ms y 1500 ms. El `429`
   del plan gratuito de Resend —el fallo más probable cuando llegan varias
   postulaciones seguidas— cede esperando un segundo. Antes el primer fallo se
   daba por definitivo.
2. Si los tres fallan, **la hoja de vida se sube a Vercel Blob** bajo
   `empleos/EMP-AAAAMMDD-XXXXXX/<uuid>.<ext>`, junto a un `registro.json` con los
   datos del formulario.
3. Con el archivo ya a salvo, sale **un último correo sin adjunto** y con un
   enlace firmado a `/api/empleos/descarga` (siete días). Si lo que hacía fallar
   el envío era el peso del adjunto, este sí sale.
4. Al candidato se le dice «Postulación enviada» **solo si el correo salió o la
   postulación quedó guardada**. Si quedó guardada sin aviso, se le enseña además
   la referencia `EMP-…` para que pueda citarla.

El **único camino que todavía pierde una postulación** es que falte
`BLOB_READ_WRITE_TOKEN`: sin store no hay dónde guardar nada. Por eso esa
variable pasa a ser obligatoria también para Empleos, y no solo para PQRS.

## Conservación de las hojas de vida (Ley 1581): seis meses

La Ley 1581 de 2012 pide una finalidad y un plazo, y «para siempre» no es un
plazo: el dato deja de poder conservarse cuando ya no sirve a la finalidad que la
persona autorizó, que aquí es un proceso de selección concreto.

**Plazo propuesto: seis meses.** Es lo habitual para hojas de vida de selección.
Cubre el proceso que motivó la postulación y deja margen para volver sobre un
candidato cuando se abre una vacante parecida, que es justo la razón por la que
una empresa guarda hojas de vida. Más allá, lo que queda no es una postulación
viva sino un archivo de datos personales sin uso.

El borrado **está escrito y probado, pero no está encendido**:

1. **El cron está declarado en `vercel.json`** (desde el 10/10/2026, a diario a
   las 08:00 UTC) y exige `CRON_SECRET`, comparado en tiempo constante
   (src/lib/cron.ts). Sin esa variable responde 503.
2. **Pero por defecto hace un simulacro.** Mientras
   `EMPLEOS_RETENCION_ACTIVA` no valga exactamente `'1'`, mira qué borraría y no
   borra nada. Se exige ese valor exacto: ni `true`, ni `si`, ni una cadena que
   alguien dejó a medias al copiar variables.

### Cómo ver qué se borraría, sin borrar nada

Con `CRON_SECRET` puesta, y sin tocar ninguna otra variable:

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  https://<despliegue>/api/empleos/limpieza | jq
```

Devuelve `simulacro: true`, cuántas postulaciones hay en el store, cuántas
pasaron del plazo y los identificadores `EMP-…` de esas. Un identificador no
dice nada de nadie: no lleva nombre, ni correo, ni teléfono.

### Cómo encenderlo, cuando se apruebe

1. Definir en Vercel `EMPLEOS_RETENCION_ACTIVA=1` (y `EMPLEOS_RETENCION_MESES`
   si el plazo acordado no son seis meses).
2. El cron ya corre a diario (`vercel.json`); no hay que tocarlo.
3. Redesplegar y mirar el registro: `[empleos/limpieza] borrado` con cuántas
   revisó y cuántas borró. Si sigue diciendo `SIMULACRO`, la variable no llegó.

> Antes de encenderlo conviene correr el simulacro una vez y mirar el número de
> `caducadas`: es lo que se llevaría por delante la primera pasada, y no se
> puede deshacer.

## Cómo saber, en los registros de Vercel, que una postulación llegó

Cada desenlace escribe **una línea sin ningún dato personal** (ni nombre, ni
correo, ni teléfono, ni nombre de archivo, ni IP, ni la huella). En Vercel →
Logs, filtrando por `[empleos/postular]`:

| Línea | Qué significa | Qué hacer |
| --- | --- | --- |
| `enviada` | El correo salió con el adjunto. **Esta es la buena.** | Nada |
| `enviada:con-enlace` | El adjunto falló; salió el correo con el enlace al Blob | Revisar por qué falla el adjunto |
| `guardada:sin-correo` | Está en el Blob y **nadie se ha enterado**. Lleva el `id` | Entrar al store y buscar ese `EMP-…` |
| `aceptada:sin-verificar` | Entró sin pasar el reto. Lleva el código de Cloudflare | Vigilar el volumen |
| `rechazo:turnstile` | Token rechazado. Lleva los códigos de Cloudflare | Cruzar con el panel del widget |
| `rechazo:limite-por-ip` | Límite. Lleva `politica` y `motor` | Si `motor` es `memoria`, falta Upstash |
| `rechazo:campos` | Validación. Lleva cuántos errores | Nada |
| `rechazo:campo-trampa` | Un envío que se descartó en silencio | Si sube, algo rellena el campo trampa |
| `fallo:correo-sin-respaldo` | No salió y **no había Blob**: postulación perdida | Poner `BLOB_READ_WRITE_TOKEN` |

**Las líneas `enviada` y `enviada:con-enlace` llevan `idResend`**, el
identificador que devolvió Resend al aceptar el envío. Es la pieza que permite
seguir un correo más allá de la función, y conviene tener claro qué NO
significa: que Resend aceptó la petición, no que el correo llegara a ninguna
bandeja. La entrega pasa después y puede acabar en rebote, en queja o en la
lista de supresión sin que la función se entere. Con el id eso se resuelve en
un paso:

```
GET https://api.resend.com/emails/<idResend>     (Authorization: Bearer <RESEND_API_KEY>)
```

El campo `last_event` de la respuesta dice qué pasó de verdad: `delivered`,
`bounced`, `complained`, `suppressed`, `queued`… Antes del 30/09/2026 ese id se
descartaba al enviar, así que una postulación registrada como «enviada» y no
recibida era irrastreable; ese fue exactamente el agujero que hubo que tapar
cuando un correo de prueba no apareció en ningún buzón.

OJO CON LA RETENCIÓN: en el plan Hobby los registros de ejecución duran **una
hora**. Pasado ese rato no queda rastro en Vercel, y la única memoria del envío
es el `idResend` si alguien lo copió, o el panel de Resend. Para una prueba,
mirar los registros **en el momento**:

```
npx vercel logs --environment production --since 10m --search "empleos/postular"
```

Para comprobar que **una postulación concreta** llegó: busca `enviada` con el
`cargo` y la marca de tiempo, y contrástalo con el correo en el buzón de Talento
Humano. Si no hay **ninguna** línea a esa hora, la petición nunca llegó a la
función y el problema está en el navegador, antes del `fetch`.

## Variables de entorno

Comparte con PQRS `TURNSTILE_SECRET`, `PUBLIC_TURNSTILE_SITE_KEY` y, si están,
`UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN`. Las suyas:

| Variable | Obligatoria | Qué es |
| --- | --- | --- |
| `RESEND_API_KEY` | sí | Clave de la cuenta de Resend de Empleos, registrada con ghsantiagodetunja@gmail.com. PQRS tiene la suya (`PQRS_RESEND_API_KEY`) y solo usa esta si no la tiene |
| `BLOB_READ_WRITE_TOKEN` | **sí** | La pone Vercel al conectar el store `pqrs-adjuntos`. Sin ella, una postulación cuyo correo falle **se pierde**: no hay dónde guardar la hoja de vida |
| `EMPLEOS_DESTINO` | no | Buzón de Talento Humano. Sin ella, `contactoEmpleo.email` de `src/data/vacantes.ts` (ghsantiagodetunja@gmail.com). Con `onboarding@resend.dev` tiene que ser el **titular de la cuenta** de `RESEND_API_KEY` |
| `EMPLEOS_REMITENTE` | no | Remitente. Sin ella, `onboarding@resend.dev`. **Ya no hereda `PQRS_REMITENTE`** |
| `EMPLEOS_RETENCION_ACTIVA` | no | Solo el valor exacto `1` enciende el borrado de las hojas de vida guardadas. Sin ella, simulacro |
| `C360_VACANTES_URL` | no | Ruta pública de Control360 con las vacantes publicadas por Talento Humano (`https://control360app.com/api/talento/vacantes/dst`). Se lee **en el build**; sin ella o si falla, `src/data/vacantes.ts` |
| `EMPLEOS_RETENCION_MESES` | no | Plazo de conservación. Sin ella, **6** |

### El orden importa: primero el remitente, después el destino

Mientras el remitente sea `onboarding@resend.dev`, Resend **solo entrega al
titular de la cuenta**. Cambiar `EMPLEOS_DESTINO` a un buzón que no sea ese
titular, sin haber cambiado antes el remitente, hace fallar **todas** las
postulaciones, y el fallo es silencioso desde fuera: el candidato ve
«Postulación enviada» (la hoja de vida se guarda en el Blob) y nadie recibe
nada.

Esto **no** es una hipótesis sobre el estado actual. Las dos variables están
cargadas en Production, y lo que se comprobó el 30/09/2026 es que la
combinación que hay puesta **funciona**: una postulación real contra
producción salió con `enviada`, `intentos:1` y su `idResend`, es decir Resend
la aceptó al primer intento. Si el destino no fuera entregable desde esa
cuenta, la respuesta habría traído una `referencia` del Blob y no la trajo.

El orden correcto, cuando dstunja.com esté verificado **en la cuenta de Resend de
Empleos**, que no es la de PQRS:

1. Verificar el dominio en Resend (los registros DNS están en
   `docs/PQRS-ADJUNTOS.md`, en «Pendiente: verificar dstunja.com en Resend»).
   Para saber cuáles faltan sin entrar a ningún panel: `npm run verificar:correo`,
   que los consulta al DNS público y no necesita credenciales.
2. Poner `EMPLEOS_REMITENTE=empleos@dstunja.com` y comprobar que sigue llegando
   al buzón por defecto.
3. **Solo entonces**, cambiar `EMPLEOS_DESTINO` al buzón de Talento Humano.

`correoRemitenteEmpleos()` dejó de heredar `PQRS_REMITENTE` justamente por esto:
son cuentas de Resend distintas, y un dominio verificado en la de PQRS no lo está
en la de Empleos. Heredarlo significaba que el día que PQRS estrenara dominio
propio, Empleos empezaría a mandar desde una dirección que su cuenta no puede
firmar y todas las postulaciones fallarían a la vez. Cuando la combinación es la
peligrosa (remitente de pruebas y destino cambiado), la función lo avisa en el
registro de Vercel antes de intentar el envío.

### Si faltan las variables de Upstash

Sin `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN` el contador del límite
por IP vive en la memoria de cada instancia: se reinicia en cada arranque en frío
y se multiplica por instancia, así que **no frena a nadie decidido**. Lo único
que puede hacer entonces es no estorbar a los candidatos de verdad, y por eso en
ese modo el límite es distinto:

| | Con Upstash | Sin Upstash (hoy) |
| --- | --- | --- |
| Tope | 5 cada 10 min | **20** cada 10 min |
| Clave | la IP | la IP **más la huella del archivo** |

La huella (`src/lib/empleos/huella.ts`) es un hash corto del nombre saneado, el
tamaño y los primeros 4 KB de la hoja de vida. Con ella, lo que se cuenta es
«esta hoja de vida desde esta IP» y no «alguien desde esta IP»: Claro, Tigo y
Movistar sacan a muchos clientes por una misma IP pública, y con el tope de 5 el
sexto candidato de un grupo de WhatsApp se quedaba fuera con un mensaje
(«espera 10 minutos») indistinguible para él de que la página estuviera rota. La
huella no se guarda en ningún sitio ni viaja al navegador o al correo.

## Dónde vive cada cosa

```
src/lib/empleos/vacantes-fuente.ts vacantes: Control360 en el build, src/data/vacantes.ts si falla
src/lib/empleos/cargos.ts          lista de cargos admitidos (vacantes + espontánea)
src/lib/empleos/hoja-de-vida.ts    formatos, tope de 3 MB y validación (navegador y servidor)
src/lib/navegador-incrustado.ts    detecta el WebView de WhatsApp/Instagram, donde el selector no abre
src/lib/empleos/config.ts          destino, remitente, los tres límites y el campo trampa
src/lib/empleos/postulacion.ts     validación del multipart, con todos los errores a la vez
src/lib/empleos/correo.ts          el correo, con reintentos, [SIN VERIFICAR] y variante con enlace
src/lib/empleos/huella.ts          hash corto de la hoja de vida, para contar sin contar personas
src/lib/empleos/almacen.ts         la red de seguridad: guardar en Blob cuando el correo no sale
src/lib/empleos/postular.ts        la orquestación, con pruebas en postular.test.ts
src/lib/empleos/respaldo.test.ts   pruebas de la red de seguridad, con el Blob simulado
src/lib/turnstile-cliente.ts       el reto en el navegador: reintento y códigos visibles
src/pages/api/empleos/postular.ts  la función de Vercel (solo el envoltorio HTTP)
src/pages/api/empleos/descarga.ts  abre una hoja de vida guardada, desde el correo de aviso
src/lib/empleos/retencion.ts       el plazo de conservacion y el borrado (nace desactivado)
src/pages/api/empleos/limpieza.ts  el cron del borrado (diario; simulacro sin EMPLEOS_RETENCION_ACTIVA=1)
src/components/FormularioEmpleo.astro  el formulario y la revisión del archivo
scripts/verificar-empleos.mjs      la prueba de navegador (móvil y escritorio)
```

## Comandos

```bash
npm run check              # tipos
npm test                   # Vitest: incluye src/lib/empleos/postular.test.ts
npm run build
npm run verificar:empleos  # Playwright sobre dist/, con la API interceptada
```

Para probar **el envío real** hace falta el entorno de Vercel, que es quien
resuelve las funciones:

```bash
npx vercel login                                   # una vez, es interactivo
npx vercel link --yes --project paginaweb --scope practicaspasantiasdst-6024
npx vercel env pull .env.local --environment production
npx vercel dev
node scripts/verificar-empleos.mjs --solo-api --api http://localhost:3000
```

Eso manda un multipart de verdad con un PDF de prueba a
`/api/empleos/postular` y enseña la respuesta completa. `--solo-api` salta las
pruebas de navegador. Dos cosas que no son obvias:

- **El token es de mentira**, así que solo pasa si el servidor usa la clave
  secreta de **prueba** de Turnstile, `1x0000000000000000000000000000000AA`. Con
  la de producción la función responde `403`, que ya demuestra que contesta.
- **La petición lleva cabecera `Origin`.** Astro rechaza con `403 Cross-site POST
  form submissions are forbidden` cualquier multipart sin ella; el navegador la
  pone solo, `fetch` de Node no, y `curl` tampoco si no se le añade `-H "Origin: …"`.

Ojo: si `RESEND_API_KEY` es real, **el correo llega de verdad** a
`EMPLEOS_DESTINO`; el nombre del candidato de prueba lo dice para que no lo
confundan con una postulación.

Astro solo permite **un** `astro dev` por carpeta. Si otra sesión ya tiene uno en
marcha, `vercel dev` o `astro dev` salen con «Dev server already running».

## Pruebas

`npm test` (`src/lib/empleos/postular.test.ts`, con Resend simulado y bytes de
archivo de verdad) comprueba: que sale un correo al buzón por defecto con el
asunto, el `replyTo` y el adjunto correctos (nombre saneado, MIME real, los
mismos bytes); que el teléfono va como `tel:` y el correo como `mailto:`; que lo
escrito llega escapado; que `EMPLEOS_DESTINO` y `EMPLEOS_REMITENTE` mandan si
están, y que `EMPLEOS_REMITENTE` **ya no** hereda el de PQRS; que se aceptan `.pdf`,
`.doc` y `.docx` mirando los bytes y no el MIME declarado; que se rechazan el
archivo ausente o vacío, un `.txt`, una imagen o texto plano disfrazados de PDF,
un ZIP renombrado a `.docx`, la doble extensión y más de 3 MB; que un PDF cuyo
nombre llega **sin extensión o con otra** —como lo entregan los selectores de
archivos de Android— se acepta y sale con la extensión de su contenido; que los campos
devuelven **todos** los errores a la vez sin gastar token; que el campo trampa
relleno da `200` sin correo ni red; los tres límites por IP (con y sin Upstash, y
el estrecho de las no verificadas); que dos hojas de vida distintas desde la misma
IP no se estorban; que Turnstile falla cerrado; que la marca `sin_verificar` se
ignora si viene un token; que un fallo de Resend se reintenta tres veces y que el
segundo intento, si sale, basta.

`src/lib/navegador-incrustado.test.ts` prueba la detección del WebView con
`User-Agent` reales de los dos lados: que se avisa dentro del navegador de
WhatsApp (que solo se delata por el token `wv`), de Instagram, de Facebook y de
TikTok, y que **no** se avisa en Chrome de Android, Samsung Internet, Firefox,
Safari de iPhone ni Chrome de escritorio. Los dos lados cuestan: no avisar deja
al candidato tocando un campo que no hace nada, y avisar de más ensucia el
formulario.

`npm run verificar:empleos` abre además la página con esos mismos `User-Agent`
(sección E) y comprueba que la franja sale con sus tres salidas, que el enlace
`intent://` solo aparece en Android, que el aviso nombra la aplicación cuando se
sabe cuál es, y que desaparece en cuanto hay una hoja de vida adjunta.

`src/lib/empleos/respaldo.test.ts` cubre la red de seguridad con el Blob
simulado: que un fallo de correo acaba en `200` y no en `500`, que la hoja de
vida se guarda con sus bytes, que el `registro.json` lleva los datos del
formulario y **no** la IP ni la huella, que sale un segundo correo sin adjunto
con el enlace firmado a `/api/empleos/descarga`, que la referencia solo se le da
al candidato cuando nadie se ha enterado todavía, y que sin
`BLOB_READ_WRITE_TOKEN` se responde `500` sin filtrar el motivo técnico.

`npm run verificar:empleos` (Playwright, en móvil y escritorio) cubre lo que se
ve: el campo con su `accept`, su ayuda y su obligatoriedad; que cada formato
válido se acepta y se enseña con nombre y peso; que los rechazados salen del
input con un mensaje claro y dejan el campo inválido; el campo trampa presente
pero invisible; la casilla obligatoria; que sin casilla o sin archivo no sale
ninguna petición; que el envío es **un** POST multipart con todos los campos, el
campo trampa vacío, el token y el archivo con sus bytes; el botón deshabilitado
con «Enviando…»; la confirmación; que un **doble clic** manda una sola
postulación; que un 400, un 429 y un 500 se muestran con su código visible y sin
abrir ningún gestor de correo; que un 403 se reenvía una vez con `sin_verificar`
y la hoja de vida completa; que una respuesta con referencia la enseña en la
confirmación; que el espejo estático y la red caída se explican con `E-SIN-API` y
`E-RED`; que WhatsApp aparece como último recurso; y el cargo preseleccionado
desde `?cargo=` y desde «Postularme».

**El envío se prueba en móvil (375×720) y en escritorio (1280×900)**, porque los
fallos que reportaron los candidatos venían del celular y el respaldo por correo
que se quitó era justo lo que peor se portaba ahí.

La sección de Turnstile corre en móvil, inyecta una clave de prueba en el HTML
(el build local no lleva ninguna) y usa un doble de Cloudflare con cinco modos:
sin interacción, el token viaja en el multipart; **pidiendo la casilla con el
token a los 33 s**, sale el aviso, a los 31 s no se ha rendido y al llegar el
token la postulación llega a la función; con error en cada intento, la
postulación sale marcada `sin_verificar` con el código de Cloudflare y el
candidato ve la confirmación; con el script bloqueado, lo mismo; y con
**`un-fallo`** —falla la primera ejecución y resuelve la segunda, que es lo que
hace un 600010 esporádico— el reintento automático consigue el token y la
postulación sale **verificada**.
