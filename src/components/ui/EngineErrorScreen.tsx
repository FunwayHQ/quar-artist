import styles from './EngineErrorScreen.module.css'

interface EngineErrorScreenProps {
  error: Error
}

/** Shown instead of the canvas when the rendering engine couldn't start. */
export function EngineErrorScreen({ error }: EngineErrorScreenProps) {
  return (
    <div className={styles.screen} role="alert" data-testid="engine-error">
      <div className={styles.panel}>
        <h1 className={styles.title}>The canvas couldn't start</h1>
        <p className={styles.text}>
          QUAR Artist paints on your graphics card through WebGPU or WebGL 2, and this browser couldn't start either
          of them.
        </p>
        <ul className={styles.tips}>
          <li>Update your browser. Current versions of Chrome, Edge, Firefox and Safari all support WebGL 2.</li>
          <li>Turn on hardware acceleration in your browser's settings.</li>
          <li>Close other tabs that use 3D graphics, then reload.</li>
        </ul>
        <pre className={styles.details}>{error.message || error.name}</pre>
        <button className={styles.reload} type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    </div>
  )
}
