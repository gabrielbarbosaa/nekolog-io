import type { LegalDocument } from '../document'

export const privacy: LegalDocument = {
  id: 'privacy',
  title: 'Política de privacidad',
  summary:
    'Qué recopilamos, qué nunca guardamos a propósito, quién trata los datos con nosotros y cómo obligarnos a borrarlos.',
  updated: '2026-11-03',
  sections: [
    {
      id: 'who-is-responsible',
      heading: 'Quién es el responsable',
      paragraphs: [
        'El controlador de los datos personales descritos aquí es Gabriel Barbosa, persona física, que además actúa como encargado de protección de datos según la LGPD brasileña. Contacto para cualquier solicitud: contato@nekolog.io.',
        'Esta política cubre el servicio alojado en nekolog.io. Una instancia que tú mismo ejecutes la controla quien la ejecuta, y esta política no se le aplica.',
      ],
    },
    {
      id: 'two-kinds-of-data',
      heading: 'Dos tipos de datos, dos papeles distintos',
      paragraphs: [
        'Los datos de tu cuenta —lo que nos das para tener una cuenta— son datos que nosotros controlamos. De eso trata esta política.',
        'Los logs que envía tu aplicación son otra cosa. Cualquier dato personal dentro de ellos lo decides enviar tú; tú eres su controlador y nosotros somos tu operador, actuando según tus instrucciones. Guardamos esos logs, te los mostramos y los borramos cuando vence su retención, y no hacemos nada más con ellos.',
      ],
    },
    {
      id: 'what-we-collect',
      heading: 'Qué recopilamos',
      paragraphs: ['Para operar el servicio alojado guardamos:'],
      items: [
        'cuenta: tu nombre, tu correo, un hash de tu contraseña y tus preferencias de idioma, zona horaria y tema',
        'seguridad: la hora de cada inicio de sesión, el país derivado de la dirección IP y el user agent del navegador, para que puedas revisar tus sesiones y para que detectemos abusos',
        'uso: cuántos eventos recibió cada proyecto y entorno por minuto, que es como se aplica la cuota',
        'soporte: lo que nos escribas, durante el tiempo necesario para resolverlo',
        'logs: lo que envíe tu aplicación, que es decisión tuya',
      ],
    },
    {
      id: 'what-we-never-store',
      heading: 'Qué nunca guardamos a propósito',
      paragraphs: ['Algunas cosas quedan fuera por decisión, no por olvido:'],
      items: [
        'tu dirección IP: se convierte en un país y se descarta; la dirección en sí nunca se escribe en ningún lado',
        'tu contraseña: solo un hash argon2id de ella, que no se puede revertir',
        'tus claves de API: solo un hash SHA-256; la clave se muestra una vez, al crearla, y nunca más',
        'cualquier cosa de rastreadores de terceros: en este sitio no hay ninguno',
      ],
    },
    {
      id: 'why',
      heading: 'Con qué base los usamos',
      paragraphs: [
        'Los datos de cuenta y de uso se tratan para ejecutar el contrato entre nosotros: darte el servicio que pediste (LGPD, artículo 7, V).',
        'Los datos de seguridad se tratan por nuestro interés legítimo en mantener segura la plataforma y a quienes la usan (artículo 7, IX), limitados a lo que esa finalidad exige.',
        'Cualquier correo que no sea sobre el funcionamiento de tu cuenta —un comunicado, por ejemplo— solo se envía con tu consentimiento, que puedes retirar en cualquier momento sin perder acceso al servicio.',
      ],
    },
    {
      id: 'retention',
      heading: 'Cuánto tiempo los guardamos',
      paragraphs: ['Cada tipo de dato tiene su propio reloj:'],
      items: [
        'logs: la retención configurada en el entorno, 7 días de forma predeterminada, tras los cuales la base de datos los borra sola',
        'datos de cuenta: mientras exista la cuenta y, después, durante el plazo en que la ley brasileña exige conservar registros',
        'registros de seguridad y auditoría: 12 meses',
        'copias de seguridad: 30 días, tras los cuales la copia se destruye; una eliminación que pidas se aplica de inmediato en la base en uso y alcanza las copias a medida que vencen',
      ],
    },
    {
      id: 'processors',
      heading: 'Quién trata datos con nosotros',
      paragraphs: [
        'Usamos infraestructura de terceros, cada una para una sola finalidad, y ninguna recibe tus datos para fines propios:',
      ],
      items: [
        'Cloudflare: recibe y enruta las solicitudes, guarda los hashes de las claves y los archivos de exportación',
        'Oracle Cloud: la máquina virtual donde funciona la base de logs',
        'Neon: la base con cuentas, organizaciones, proyectos y claves',
        'Upstash: el almacenamiento temporal de sesiones y códigos de inicio de sesión',
        'Vercel: sirve este sitio y el panel',
        'Resend: entrega nuestros correos',
      ],
    },
    {
      id: 'international-transfer',
      heading: 'Datos fuera de Brasil',
      paragraphs: [
        'Esos proveedores operan servidores fuera de Brasil, así que operar el servicio implica una transferencia internacional de datos (LGPD, artículo 33). Elegimos proveedores que se comprometen contractualmente con una protección equivalente a la que exige la LGPD, y enviamos a cada uno solo lo que su única finalidad necesita.',
      ],
    },
    {
      id: 'cookies',
      heading: 'Cookies',
      paragraphs: [
        'Usamos cookies solo para lo que no funcionaría sin ellas: mantener tu sesión, recordar tu idioma y recordar tu tema. No hay cookie de analítica, ni de publicidad, ni de terceros.',
        'Como ninguna te rastrea, tampoco hay ese banner pidiéndote que las aceptes.',
      ],
    },
    {
      id: 'your-rights',
      heading: 'Tus derechos',
      paragraphs: [
        'La LGPD te da derecho a confirmar que tratamos tus datos, a acceder a ellos, a corregirlos, a pedir su anonimización o eliminación, a llevártelos en un formato portable, a saber con quién los compartimos y a revocar un consentimiento que hayas dado.',
        'Escribe a contato@nekolog.io y responderemos en hasta 15 días. Podemos pedirte que confirmes tu identidad antes, para que nadie ejerza tus derechos en tu lugar.',
        'Si crees que no atendimos bien tu solicitud, puedes reclamar ante la Autoridad Nacional de Protección de Datos de Brasil (ANPD).',
      ],
    },
    {
      id: 'deletion',
      heading: 'Eliminar tu cuenta',
      paragraphs: [
        'Puedes eliminar tu cuenta tú mismo, desde el panel, sin escribirle a nadie. La eliminación borra los datos de tu cuenta y los logs de las organizaciones que existen solo por ti.',
        'Una organización con otros miembros sobrevive a tu salida: sus logs no son tuyos para borrarlos. Los registros que la ley nos obliga a conservar —un evento de seguridad, por ejemplo— se mantienen el plazo exigido y nada más.',
      ],
    },
    {
      id: 'security',
      heading: 'Cómo los protegemos',
      paragraphs: [
        'Todo viaja por TLS. Las contraseñas usan hash argon2id y las claves de API, SHA-256. Cada componente tiene solo los permisos de base de datos que su trabajo exige, los secretos nunca viven en el código fuente, y este sitio se sirve con una política de seguridad de contenido que bloquea cualquier script que no hayamos puesto nosotros.',
        'Nuestro modelo de amenazas es público, en el repositorio, incluidos los riesgos que aceptamos y por qué. Ningún sistema es inmune, y el nuestro lo mantiene una sola persona: preferimos que lo sepas a que supongas lo contrario.',
      ],
    },
    {
      id: 'incidents',
      heading: 'Si algo sale mal',
      paragraphs: [
        'Si un incidente de seguridad pone tus datos en riesgo relevante, lo comunicaremos a la ANPD y a ti, describiendo qué pasó, qué datos estuvieron involucrados y qué estamos haciendo al respecto, como exige el artículo 48 de la LGPD.',
      ],
    },
    {
      id: 'children',
      heading: 'Niñas, niños y adolescentes',
      paragraphs: [
        'El servicio no está dirigido a menores de 18 años y no recopilamos sus datos a sabiendas. Si crees que un menor tiene una cuenta aquí, escribe a contato@nekolog.io y la eliminaremos.',
      ],
    },
    {
      id: 'changes',
      heading: 'Cambios en esta política',
      paragraphs: [
        'La fecha de arriba muestra el último cambio. Los cambios relevantes se avisan por correo a quienes tienen cuenta con al menos 15 días de antelación, para que puedas discrepar antes de que se te apliquen.',
      ],
    },
    {
      id: 'contact',
      heading: 'Contacto',
      paragraphs: [
        'Cualquier duda o solicitud sobre tus datos: contato@nekolog.io. La misma dirección llega al encargado de protección de datos.',
      ],
    },
  ],
}
