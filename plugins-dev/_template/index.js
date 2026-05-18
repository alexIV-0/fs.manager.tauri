/**
 * Plugin Entry Point
 * 
 * This is the main file that gets loaded by the Plugin Manager.
 * It receives an API object that provides access to Electron APIs and app utilities.
 */

export default class ExamplePlugin {
  constructor(api) {
    this.api = api;
    this.name = 'Example Plugin';
  }

  /**
   * Called when plugin is loaded
   */
  async onLoad() {
    console.log(`${this.name} loaded!`);
    
    // Access to Electron built-in modules (provided by app)
    const { fs, path } = this.api.node;
    
    // Access to shared utilities (copied during build)
    const { logger } = this.api.utils;
    
    logger.info('Plugin initialized');
  }

  /**
   * Called when plugin is unloaded
   */
  async onUnload() {
    console.log(`${this.name} unloaded!`);
  }

  /**
   * Example method - process a file
   */
  async processFile(filePath) {
    const { fs, path } = this.api.node;
    const { logger } = this.api.utils;
    
    try {
      logger.info(`Processing file: ${filePath}`);
      
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const fileName = path.basename(filePath);
      
      // Do something with the file...
      logger.info(`Processed: ${fileName}`);
      
      return { success: true, fileName };
    } catch (error) {
      logger.error(`Error processing file: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get plugin settings
   */
  getSettings() {
    return this.api.settings.get(this.name) || {};
  }

  /**
   * Update plugin settings
   */
  updateSettings(newSettings) {
    this.api.settings.set(this.name, newSettings);
  }
}
