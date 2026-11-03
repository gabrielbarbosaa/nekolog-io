import type { LegalDocument } from '../document'

export const terms: LegalDocument = {
  id: 'terms',
  title: 'Términos de uso',
  summary:
    'Qué ofrece NekoLog, qué asumes al usarlo y qué ninguna de las dos partes puede prometerle a la otra.',
  updated: '2026-11-03',
  sections: [
    {
      id: 'who-we-are',
      heading: 'Quién mantiene NekoLog',
      paragraphs: [
        'NekoLog lo mantiene Gabriel Barbosa, persona física, en contato@nekolog.io. No es una empresa, y el servicio alojado se ofrece de forma gratuita.',
        'Estos términos rigen el servicio alojado en nekolog.io. Si ejecutas NekoLog por tu cuenta desde el repositorio abierto, no se aplican a ti: tu instancia es tuya.',
      ],
    },
    {
      id: 'what-the-service-is',
      heading: 'Qué es el servicio',
      paragraphs: [
        'NekoLog recibe los logs que tu aplicación envía mediante nuestros SDK, los guarda durante un período limitado y te los muestra en un panel con búsqueda, gráficos y alertas.',
        'Los SDK, la API de ingesta, los jobs y este sitio son de código abierto, con licencia MIT. El panel es de código cerrado y solo funciona en la instancia alojada.',
      ],
    },
    {
      id: 'accounts',
      heading: 'Cuentas',
      paragraphs: [
        'En la instancia alojada, una cuenta solo nace de una invitación: nuestra o de alguien de la organización a la que te unes.',
        'Respondes por todo lo que se haga con tus credenciales. Avísanos a contato@nekolog.io en cuanto sospeches que alguien más las tiene.',
        'Hay que tener 18 años o más para tener cuenta.',
      ],
    },
    {
      id: 'your-logs',
      heading: 'Los logs que envías son tuyos, y son tu responsabilidad',
      paragraphs: [
        'Quien decide qué envía la aplicación eres tú. Nosotros los guardamos y te los mostramos; no los leemos, no los vendemos y no los usamos para entrenar nada.',
        'Según la ley brasileña de protección de datos, tú eres el controlador de cualquier dato personal dentro de esos logs y nosotros actuamos como operador. Envía solo lo que necesitas. Nuestros SDK eliminan secretos comunes antes de que nada salga de tu proceso, pero eso es una red de seguridad, no una garantía: la obligación de no enviar lo que no debería enviarse sigue siendo tuya.',
      ],
    },
    {
      id: 'acceptable-use',
      heading: 'Qué no puedes hacer',
      paragraphs: ['Al usar el servicio alojado, te comprometes a no:'],
      items: [
        'enviar contenido ilícito, o que no tengas derecho a enviar',
        'intentar leer, escribir o deducir cualquier cosa de otra organización',
        'eludir cuotas, límites de tasa o el requisito de invitación',
        'atacar la plataforma o usarla para atacar a alguien, incluido probarla sin autorización por escrito',
        'revender el servicio alojado o presentarlo como propio',
      ],
    },
    {
      id: 'quotas-and-retention',
      heading: 'Cuotas y retención',
      paragraphs: [
        'La instancia alojada acepta hasta 10.000 eventos por día por organización y los conserva 7 días de forma predeterminada. Ambos valores pueden ajustarse por organización, y los vigentes aparecen siempre en el panel.',
        'Los logs se eliminan automáticamente cuando vence su retención. Eliminar es definitivo: no hay archivo desde el cual restaurarlos. Si los necesitas por más tiempo, expórtalos antes del vencimiento.',
      ],
    },
    {
      id: 'availability',
      heading: 'Sin nivel de servicio y sin garantía',
      paragraphs: [
        'El servicio se ofrece tal cual. Funciona sobre las cuotas gratuitas de terceros y lo mantiene una sola persona en su tiempo libre. Puede ir lento, puede detenerse, puede cambiar, y pueden perderse eventos.',
        'No conviertas NekoLog en el único registro de algo que no puedes perder: una pista de auditoría, una obligación legal, una base de facturación. Guarda tu propia copia de lo que importa tanto.',
        'En los límites de la ley, no respondemos por daño indirecto, lucro cesante ni pérdida de datos derivados del uso del servicio alojado.',
      ],
    },
    {
      id: 'suspension',
      heading: 'Suspensión y fin del servicio',
      paragraphs: [
        'Podemos suspender una cuenta u organización que incumpla estos términos, o cuyo uso ponga en riesgo la plataforma y a quienes la usan. Cuando sea razonable avisar antes, avisaremos.',
        'Puedes dejar de usarlo cuando quieras y pedir que eliminemos tu cuenta. Nosotros también podemos cerrar la instancia alojada; si ocurre, avisaremos por correo con al menos 30 días de antelación para que exportes tus datos.',
      ],
    },
    {
      id: 'intellectual-property',
      heading: 'Propiedad intelectual',
      paragraphs: [
        'El repositorio público tiene licencia MIT, y es esa licencia la que dice qué puedes hacer con ese código. El panel no está cubierto por ella ni se licencia para redistribución.',
        'El nombre NekoLog y las marcas del proyecto no están cubiertos por la licencia MIT. Puedes decir que tu producto funciona con NekoLog; no puedes presentar un fork como si fuera NekoLog.',
      ],
    },
    {
      id: 'changes',
      heading: 'Cambios en estos términos',
      paragraphs: [
        'Podemos cambiar estos términos. La fecha de arriba muestra siempre el último cambio, y los cambios relevantes se avisan por correo a quienes tienen cuenta con al menos 15 días de antelación.',
        'Seguir usando el servicio después de esa fecha significa aceptar la nueva versión. Si no la aceptas, deja de usarlo y pide que eliminemos tu cuenta.',
      ],
    },
    {
      id: 'law',
      heading: 'Ley aplicable',
      paragraphs: [
        'Estos términos se rigen por la ley brasileña. En una relación de consumo, el fuero competente es el del domicilio del consumidor, como prevé el Código de Defensa del Consumidor.',
      ],
    },
    {
      id: 'contact',
      heading: 'Contacto',
      paragraphs: ['Dudas sobre estos términos: contato@nekolog.io.'],
    },
  ],
}
