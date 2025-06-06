import '../styles/globals.css'
import type { AppProps } from 'next/app'

// Este componente es la plantilla principal de toda tu aplicación.
// La línea de arriba importa los estilos globales para que se apliquen en todas las páginas.
export default function App({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />
}