const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const logger = require('./utils/logger');
const AmiApiService = require('./services/ami_api');
const path = require('path');
const socketio = require('socket.io');
const { handleAgentAction } = require('./services/actionHandlers');
// Load environment variables first
dotenv.config();

const { exec } = require('child_process');
// Validate requnired environment variables
const requiredEnvVars = [
    'AMI_HOST', 'AMI_PORT', 'AMI_USER', 'AMI_PASSWD',

];

for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        logger.error(`Missing required environment variable: ${envVar}`);
        process.exit(1);
    }
}

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize services
let server;
let serviceInitialized = false;

async function initializeServices() {
    try {
        logger.info('🔌 Initializing services...');
        await AmiApiService.initialize(process.env.AMI_HOST, process.env.AMI_PORT, process.env.AMI_USER, process.env.AMI_PASSWD, io);
        serviceInitialized = true;
        logger.info('✅ All services initialized successfully');
    } catch (err) {
        logger.error('❌ Service initialization failed:', err);
        throw err;
    }
}

// Start HTTP server
try {
    const PORT = parseInt(process.env.PORT) || 3001;
    server = app.listen(PORT, async () => {
        logger.info(`🚀 Backend server is live on port: ${PORT}`);
        try {
            await initializeServices();
        } catch (err) {
            logger.error('❌ Failed to initialize services:', err);
            // Don't exit immediately - server can run in degraded mode
        }
    });

    server.on('error', (err) => {
        logger.error('Server error:', err);
        process.exit(1);
    });
} catch (err) {
    logger.error('❌ Failed to start server:', err);
    process.exit(1);
}
const io = socketio(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Routes
app.post('/app/odoo_pbx/agent', async (req, res) => {
    if (!serviceInitialized) {
        return res.status(503).json({ error: 'Service initializing, try again later' });
    }

    try {
        console.log(req.body)
        const result = await handleAgentAction(req.body);
        console.log(result);
        res.status(200).json(result);

    } catch (err) {
        logger.error('Agent action processing error:', err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Internal Server Error' });
    }
});
app.use(express.static('web'));

app.get('/Phone', async (req, res) => {
    const _retfile = path.join(__dirname, 'web', 'index.html');
    res.sendFile(path.resolve(__dirname, 'web', 'index.html'))
})

app.get('/health', async (req, res) => {
    AmiApiService.asteriskPing()
    // odooService.getPBXconfiguration()
    try {
        const health = {
            status: serviceInitialized ? 'ok' : 'initializing',
            services: {
                ami: {
                    connected: AmiApiService.isConnected(),
                    status: AmiApiService.getStatus()
                },
            },
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        };

        const statusCode = serviceInitialized ? 200 : 503;
        res.status(statusCode).json(health);
    } catch (err) {
        res.status(500).json({
            status: 'error',
            error: err.message
        });
    }
});

// Update the metrics endpoint
app.get('/metrics', async (req, res) => {
    try {
        const metrics = {
            status: 'ok',
            system: {
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                cpu: process.cpuUsage()
            },
            services: {
                ami: await AmiApiService.getMetrics(),
            },
            timestamp: new Date().toISOString()
        };

        res.status(200).json(metrics);
    } catch (err) {
        res.status(500).json({
            status: 'error',
            error: err.message
        });
    }
});
// Error handling middleware
app.use((err, req, res, next) => {
    logger.error('Request error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Process termination handlers
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
async function gracefulShutdown() {
    logger.info('SIGINT/SIGTERM received. Shutting down gracefully...');
    try {
        await AmiApiService.shutdown();
        logger.info('All services closed. Goodbye! 👋');
        process.exit(0);
    } catch (err) {
        logger.error('Error during graceful shutdown:', err);
        process.exit(1);
    }
}



app.post('/soft_phone/command', async (req, res) => {
    const { command, path } = req.body;
    console.log(req.body)
    try {
        exec(`"${path}" /${command}`, (error, stdout, stderr) => {
            if (error) {
                logger.error('SoftPhone command failed:', error);
                return res.status(500).json({ error: 'Command execution failed' });
            }
            res.status(200).json({ status: 'success' });
        });
    } catch (err) {
        logger.error('SoftPhone route error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Unhandled rejection/exception handlers
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    // Don't exit immediately for uncaught exceptions - try to keep running
});
