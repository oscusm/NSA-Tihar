// sample-data.js
// Built-in groups and questions so the game works BEFORE you connect a Google Sheet.
// Once you load a sheet or upload a CSV, that data replaces these.

module.exports = {
  // The four Tihar animals: Kag (crow), Kukur (dog), Gai (cow), Goru (ox)
  groups: [
    { name: 'Crow', emoji: '🐦‍⬛', color: '#3a3f8f', sound: 'crow' },
    { name: 'Dog',  emoji: '🐶',   color: '#0f9d76', sound: 'dog' },
    { name: 'Cow',  emoji: '🐄',   color: '#d9622b', sound: 'cow' },
    { name: 'Ox',   emoji: '🐂',   color: '#c0263a', sound: 'ox' },
  ],

  // question + answer only (every question: 10 points, 15 second timer)
  questions: [
    { question: 'How many days is Tihar celebrated?', answer: 'Five days' },
    { question: 'On which day of Tihar are dogs worshipped?', answer: 'Kukur Tihar (the 2nd day)' },
    { question: 'What is the last day of Tihar called, when sisters put tika on their brothers?', answer: 'Bhai Tika' },
    { question: 'What is the capital of Nepal?', answer: 'Kathmandu' },
    { question: "What is Nepal's national flower?", answer: 'Rhododendron (Lali Gurans)' },
    { question: 'What is the nickname of Southern Miss athletics teams?', answer: 'Golden Eagles' },
    { question: 'In which city is the main Southern Miss campus?', answer: 'Hattiesburg, Mississippi' },
    { question: 'What are the two official colors of Southern Miss?', answer: 'Black and gold' },
    { question: 'Name the ring-shaped, sweet fried rice bread made at home during Tihar.', answer: 'Sel roti' },
    { question: 'What do Nepalis call steamed dumplings?', answer: 'Momo' },
    { question: 'Dal, bhat and ___? (the classic Nepali meal)', answer: 'Tarkari' },
  ],
};
