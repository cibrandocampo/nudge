import dbm.dumb
import os
import shelve

from celery import Celery
from celery.beat import PersistentScheduler

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "nudge.settings")

app = Celery("nudge")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()


class _DumbShelve:
    """`shelve`, but always over `dbm.dumb` — what `PersistentScheduler` uses as `persistence`."""

    @staticmethod
    def open(filename, writeback=False):
        return shelve.Shelf(dbm.dumb.open(filename, "c"), writeback=writeback)


class DumbDbmScheduler(PersistentScheduler):
    """Celery's persistent beat scheduler, storing its schedule with `dbm.dumb`.

    Since Python 3.13, `shelve` creates new files with `dbm.sqlite3` (WAL mode)
    when no gdbm is installed, which is the case in the slim images. When beat
    still ran embedded in the worker (`-B`, a forked child), that SQLite store
    failed with `sqlite3.OperationalError: locking protocol` on a routine
    sync: the beat process died while the worker stayed up, and every
    scheduled job — notifications, the regulatory sync — silently stopped.
    Beat now has its own container (restarted by Docker if it dies), and its
    store is `dbm.dumb`: plain files with no locking, which is all one beat
    process needs (and what `shelve` picked on these images before 3.13).
    """

    persistence = _DumbShelve
