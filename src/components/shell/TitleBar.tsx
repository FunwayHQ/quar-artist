import styles from './TitleBar.module.css'

export function TitleBar() {
  return (
    <header className={`glass ${styles.titleBar}`}>
      <div className={styles.brand}>
        <img src="/logo.svg" alt="QUAR Artist" className={styles.logo} />
      </div>
      <nav className={styles.menu}>
        <button className={styles.menuItem}>File</button>
        <button className={styles.menuItem}>Edit</button>
        <button className={styles.menuItem}>View</button>
        <button className={styles.menuItem}>Selection</button>
        <button className={styles.menuItem}>Help</button>
      </nav>
      <div className={styles.projectName}>Untitled Project</div>
    </header>
  )
}
