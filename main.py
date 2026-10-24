import re
from pathlib import Path
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from tensorflow.keras.models import load_model
from tensorflow.keras.preprocessing.sequence import pad_sequences
from tensorflow.keras.preprocessing.text import tokenizer_from_json


FOLDER = Path(__file__).resolve().parent
SEQ_LEN = 12
model = load_model(FOLDER / "model" / "next_word.keras", compile=False)
with open(FOLDER / "model" / "tokenizer.json", encoding="utf-8") as file:
    tokenizer = tokenizer_from_json(file.read())
unknown_id = tokenizer.word_index[tokenizer.oov_token]

app = FastAPI(title="Story Next Word")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class PredictionInput(BaseModel):
    text: str = Field(min_length=1, max_length=3000)


def clean_text(text):
    text = text.lower().replace("\u2018", "'").replace("\u2019", "'").replace("\u02bc", "'")
    return " ".join(re.findall(r"[a-z]+(?:'[a-z]+)?", text))


@app.get("/")
def root():
    return {
        "message": "RNN API is running",
        "docs": "/docs"
    }

@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": model is not None}



@app.post("/predict")
def predict(request: PredictionInput):
    text = clean_text(request.text)
    words = text.split()
    tokens = tokenizer.texts_to_sequences([text])[0]

    if not tokens:
        raise HTTPException(status_code=400, detail="Please enter some English words.")
    if all(token == unknown_id for token in tokens[-SEQ_LEN:]):
        raise HTTPException(status_code=400, detail="These words are new to this model. Try a phrase from the story.")

    padded = pad_sequences([tokens], maxlen=SEQ_LEN, padding="pre", truncating="pre")
    probabilities = model(padded, training=False).numpy()[0].astype(np.float64)
    probabilities[0] = 0
    probabilities[unknown_id] = 0
    probabilities /= probabilities.sum()

    best_ids = np.argsort(probabilities)[-3:][::-1]
    suggestions = [
        {"word": tokenizer.index_word[int(word_id)], "probability": float(probabilities[word_id])}
        for word_id in best_ids
    ]
    unknown_words = list(dict.fromkeys(word for word in words if word not in tokenizer.word_index))

    return {
        "word": suggestions[0]["word"],
        "suggestions": suggestions,
        "unknown_words": unknown_words,
    }