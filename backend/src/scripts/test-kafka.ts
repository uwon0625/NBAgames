import { Kafka } from 'kafkajs';

async function testKafkaConnection() {
  const kafka = new Kafka({
    clientId: 'test-client',
    brokers: ['localhost:9092']
  });

  const producer = kafka.producer();

  try {
    console.log('Connecting to Kafka...');
    await producer.connect();
    console.log('Successfully connected to Kafka');

    await producer.send({
      topic: 'nba-game-updates',
      messages: [
        { 
          key: 'test',
          value: JSON.stringify({ test: 'message' })
        }
      ]
    });
    console.log('Successfully sent test message');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await producer.disconnect();
  }
}

testKafkaConnection().catch(console.error); 