## 🌐 Live Links

- **Live Demo:** [Try the Text Generator](https://rrn-text-generation.onrender.com)
- **Backend API:** [Check API Status](https://text-generation-oah3.onrender.com)
- **API Documentation:** [Explore Swagger UI](https://text-generation-oah3.onrender.com/docs)

# ✍️ RNN Text Generation (Next Word Prediction)

An end-to-end Deep Learning web application that **predicts the next word and generates text** from a starting phrase. The model is built using **TensorFlow/Keras** with a **Recurrent Neural Network (RNN)**, served via a high-performance **FastAPI** backend, and paired with a responsive **HTML, CSS, and JavaScript** frontend.

---

## ✨ Features

* **Next Word Prediction:** Type a few words and the model predicts the most likely next word(s) learned from the training story.
* **Text Generation:** Generate longer passages by repeatedly feeding predicted words back into the model.
* **RNN Architecture:** Uses an `Embedding` layer with recurrent layers and a softmax output over the full vocabulary.
* **FastAPI Backend:** Asynchronous REST API that loads the `.keras` model and `tokenizer.json` once at startup and serves real-time predictions.
* **Interactive Web Frontend:** Clean, simple interface to enter a seed text, choose how many words to generate, and view the output instantly, with live API health checking.

---

## 📂 Project Structure

```text
text-generation/
├── main.py                              # FastAPI backend server
├── data/
│   └── Story.txt                        # Training text corpus
├── model/
│   ├── next_word.keras                  # Trained TensorFlow/Keras model
│   ├── tokenizer.json                   # Saved Keras tokenizer (word → index mapping)
│   └── RNN.ipynb                        # Model training & evaluation notebook
├── frontend/
│   ├── index.html                       # Main user interface
│   ├── style.css                        # Styling and layout
│   └── script.js                        # API integration and DOM logic
├── .gitignore                           # Ignored files for Git
└── README.md                            # Project documentation
```

---

## 📊 Dataset & Model Details

* **Dataset:** `Story.txt`, a custom text corpus (story) used to train the language model.
* **Preprocessing:** Text is cleaned, tokenized with the Keras `Tokenizer`, and converted into n-gram sequences (input words → next word).
* **Padding:** Sequences are padded to a fixed length so the model accepts consistent input shapes.
* **Tokenizer:** Saved as `tokenizer.json` so the backend uses the exact same vocabulary as training.
* **Model Architecture:** `Embedding` + `RNN (LSTM/GRU)` layers + `Dense(vocab_size, activation='softmax')`.
* **Loss & Optimizer:** `categorical_crossentropy` with the `Adam` optimizer.
* **Output:** Probability distribution over the vocabulary; the highest-probability word is selected as the next word.

---

## 🛠️ Tech Stack

* **Deep Learning:** TensorFlow, Keras, NumPy
* **Backend API:** FastAPI, Uvicorn
* **Frontend:** HTML5, CSS3, Vanilla JavaScript (`fetch` API)

---

## 📌 Notes

* The free Render tier may "sleep" after inactivity, so the first request can take 30–60 seconds to wake the backend.
* The model only knows words from `Story.txt`, so unknown words in the input are ignored by the tokenizer.