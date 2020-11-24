import { config } from './config'
import { app } from './server'

// Instantiate server
app.listen(config.httpPort, () => {
  console.log('Server is listening on:', config.httpPort)
})
