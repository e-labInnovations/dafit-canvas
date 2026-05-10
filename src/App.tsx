import { NavLink, Route, Routes } from 'react-router-dom'
import Home from './pages/Home'
import WatchFaces from './pages/WatchFaces'
import UploadWatchFace from './pages/UploadWatchFace'
import Editor from './pages/Editor'
import Dump from './pages/Dump'
import './App.css'

function App() {
  return (
    <>
      <nav className="top-nav">
        <NavLink to="/" end>
          Home
        </NavLink>
        <NavLink to="/watch-faces">Watch faces</NavLink>
        <NavLink to="/editor">Editor</NavLink>
        <NavLink to="/dump">Dump</NavLink>
        <NavLink to="/upload">Upload</NavLink>
      </nav>

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/watch-faces" element={<WatchFaces />} />
        <Route path="/editor" element={<Editor />} />
        <Route path="/dump" element={<Dump />} />
        <Route path="/upload" element={<UploadWatchFace />} />
      </Routes>
    </>
  )
}

export default App
