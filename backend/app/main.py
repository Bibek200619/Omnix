from __future__ import annotations
from .bootstrap.app import create_app
from fastapi.middleware.cors import CORSMiddleware

app = create_app()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://omnix-utd4b6yzf-crazy764gaming-4092s-projects.vercel.app/login"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)