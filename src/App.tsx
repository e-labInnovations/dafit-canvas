import { useState } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import { Info } from 'lucide-react'
import Tooltip from './components/Tooltip'
import Home from './pages/Home'
import WatchFaces from './pages/WatchFaces'
import UploadWatchFace from './pages/UploadWatchFace'
import Editor from './pages/Editor'
import Dump from './pages/Dump'
import Pack from './pages/Pack'
import Docs from './pages/Docs'
import WatchConsole from './pages/WatchConsole'
import AboutModal from './components/AboutModal'
import './App.css'

function App() {
  const [aboutOpen, setAboutOpen] = useState(false)

  return (
    <>
      <nav className="top-nav">
        <NavLink to="/" end>
          Home
        </NavLink>
        <NavLink to="/watch-faces">Watch faces</NavLink>
        <NavLink to="/editor">Editor</NavLink>
        <NavLink to="/dump">Dump</NavLink>
        <NavLink to="/pack">Pack</NavLink>
        <NavLink to="/upload">Upload</NavLink>
        <NavLink to="/console">Console</NavLink>
        <NavLink to="/docs">Docs</NavLink>
        <Tooltip content="About">
          <button
            type="button"
            className="top-nav-about"
            onClick={() => setAboutOpen(true)}
            aria-label="About DaFit Canvas"
          >
            <Info size={16} aria-hidden />
            <span>About</span>
          </button>
        </Tooltip>
      </nav>

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/watch-faces" element={<WatchFaces />} />
        <Route path="/editor" element={<Editor />} />
        <Route path="/dump" element={<Dump />} />
        <Route path="/pack" element={<Pack />} />
        <Route path="/upload" element={<UploadWatchFace />} />
        <Route path="/console" element={<WatchConsole />} />
        <Route path="/docs" element={<Docs />} />
      </Routes>

      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </>
  )
}

export default App
