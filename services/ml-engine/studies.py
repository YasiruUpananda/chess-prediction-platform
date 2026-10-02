"""Private, bounded study snapshots. Ownership comes only from verified tokens."""
from datetime import datetime
from uuid import UUID, uuid4
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from psycopg.types.json import Jsonb
from database import connect
from token_auth import require_asgardeo_user
from chess_positions import validated_board
from operations import admit

router = APIRouter(prefix='/api/v1/studies', tags=['Studies'])


class StudyInput(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    fen: str = Field(min_length=10, max_length=120)
    initial_fen: str = Field(min_length=10, max_length=120)
    moves: list[str] = Field(max_length=1500)
    opponent_name: str = Field(default='', max_length=120)
    context: str = Field(default='', max_length=2000)
    color: str = Field(default='any', pattern='^(any|white|black)$')


class SavedStudy(StudyInput):
    id: UUID
    created_at: datetime


class StudyList(BaseModel):
    studies: list[SavedStudy]


def study_user(user=Depends(require_asgardeo_user)):
    return admit(user, 'studies', 30)


@router.get('', response_model=StudyList)
def list_studies(user=Depends(study_user)):
    with connect() as db:
        rows = db.execute('SELECT id,title,snapshot,created_at FROM saved_studies '
                          'WHERE owner=%s ORDER BY created_at DESC LIMIT 100', (user['sub'],)).fetchall()
    return {'studies': [{**snapshot, 'id': study_id, 'title': title, 'created_at': date}
                        for study_id, title, snapshot, date in rows]}


@router.post('', status_code=201, response_model=SavedStudy)
def save_study(body: StudyInput, user=Depends(study_user)):
    try: validated_board(body.fen, body.initial_fen, body.moves)
    except ValueError as error: raise HTTPException(400, detail=str(error)) from error
    title = body.title.strip()
    if not title: raise HTTPException(400, detail='Enter a study name.')
    with connect() as db:
        # Serialize admission per owner, so concurrent saves cannot exceed the cap.
        db.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s,734212))', (user['sub'],))
        count = db.execute('SELECT count(*) FROM saved_studies WHERE owner=%s', (user['sub'],)).fetchone()[0]
        if count >= 100: raise HTTPException(409, detail='Study limit reached. Delete an older study first.')
        study_id = uuid4()
        date = db.execute('INSERT INTO saved_studies(id,owner,title,snapshot) VALUES (%s,%s,%s,%s) '
                          'RETURNING created_at', (study_id, user['sub'], title, Jsonb(body.model_dump()))).fetchone()[0]
    return {**body.model_dump(), 'id': study_id, 'title': title, 'created_at': date}


@router.delete('/{study_id}', status_code=204)
def delete_study(study_id: UUID, user=Depends(study_user)):
    with connect() as db:
        deleted = db.execute('DELETE FROM saved_studies WHERE id=%s AND owner=%s RETURNING id',
                             (study_id, user['sub'])).fetchone()
    if not deleted: raise HTTPException(404, detail='Study not found.')
