require('dotenv').config();
const mongoose = require('mongoose');

console.log('Testing MongoDB Atlas connection...');
console.log('Connection String:', process.env.MONGODB_URI);

const mongoOptions = {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000, // 5 seconds timeout for testing
    connectTimeoutMS: 10000
};

async function testConnection() {
    try {
        console.log('Attempting to connect to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI, mongoOptions);
        
        console.log('✅ Successfully connected to MongoDB!');
        
        // Test a simple database operation
        const db = mongoose.connection.db;
        const collections = await db.listCollections().toArray();
        console.log('\n📋 Collections in database:');
        collections.forEach(col => console.log(`- ${col.name}`));
        
        // Test a ping to the database
        const ping = await db.command({ ping: 1 });
        console.log('\n🏓 Database ping result:', ping);
        
        process.exit(0);
    } catch (error) {
        console.error('❌ MongoDB connection error:', error.message);
        console.error('Error details:', error);
        
        if (error.name === 'MongooseServerSelectionError') {
            console.log('\n🔍 Common causes:');
            console.log('1. Your IP address might not be whitelisted in MongoDB Atlas');
            console.log('2. The connection string might be incorrect');
            console.log('3. There might be network connectivity issues');
            console.log('\n💡 Tip: Check your MongoDB Atlas Network Access settings to ensure your IP is whitelisted.');
        }
        
        process.exit(1);
    }
}

testConnection();
