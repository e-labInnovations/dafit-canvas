import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  Bluetooth,
  BookOpen,
  Compass,
  LayoutDashboard,
} from 'lucide-react'

type Card = {
  to: string
  icon: React.ComponentType<{ size?: number; 'aria-hidden'?: boolean }>
  title: string
  blurb: string
}

const CARDS: Card[] = [
  {
    to: '/watch-faces',
    icon: Compass,
    title: 'Browse',
    blurb: 'Search 387+ MoYoung faces from the official catalogue.',
  },
  {
    to: '/editor',
    icon: LayoutDashboard,
    title: 'Edit',
    blurb: 'Layers, shared asset library, font-to-digit generator.',
  },
  {
    to: '/upload',
    icon: Bluetooth,
    title: 'Upload',
    blurb: 'Flash a built .bin to your watch over Web Bluetooth.',
  },
  {
    to: '/docs',
    icon: BookOpen,
    title: 'Learn',
    blurb: 'How a Type C watch face is laid out, explained plainly.',
  },
]

function Home() {
  return (
    <section id="center" className="home">
      <header className="home-hero">
        <img
          src="/logo.svg"
          alt="DaFit Canvas logo"
          className="home-logo"
          width={140}
          height={140}
        />
        <h1>DaFit Canvas</h1>
        <p className="home-tagline">
          Design and flash smartwatch faces for the{' '}
          <strong>Da Fit / MoYoung</strong> ecosystem — right in your
          browser. No installs, no telemetry, no backend.
        </p>
        <div className="home-cta">
          <Link to="/editor" className="counter">
            Open the editor
          </Link>
          <Link to="/watch-faces" className="counter ghost">
            Browse faces
          </Link>
        </div>
      </header>

      <nav className="home-cards" aria-label="Quick links">
        {CARDS.map((c) => {
          const Icon = c.icon
          return (
            <Link key={c.to} to={c.to} className="home-card">
              <span className="home-card-icon" aria-hidden>
                <Icon size={20} />
              </span>
              <strong>{c.title}</strong>
              <span className="home-card-blurb">{c.blurb}</span>
            </Link>
          )
        })}
      </nav>

      <footer className="home-foot">
        <p className="home-disclaimer">
          <AlertTriangle size={14} aria-hidden />
          <span>
            Hobby software — use at your own risk. Tested on Porodo{' '}
            <em>Vortex</em> (firmware <code>MOY-GKE5-2.2.7</code>).
          </span>
        </p>
      </footer>
    </section>
  )
}

export default Home
