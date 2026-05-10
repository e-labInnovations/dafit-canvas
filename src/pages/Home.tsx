import { Link } from 'react-router-dom'

function Home() {
  return (
    <section id="center">
      <div>
        <h1>DaFit Canvas</h1>
        <p>Design smartwatch faces for the Da Fit / MoYoung ecosystem.</p>
      </div>
      <Link to="/watch-faces" className="counter">
        Browse watch faces
      </Link>
    </section>
  )
}

export default Home
