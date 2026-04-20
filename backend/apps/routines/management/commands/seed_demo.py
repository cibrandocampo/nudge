from datetime import date, time, timedelta

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.routines.models import Routine, RoutineEntry, Stock, StockLot

User = get_user_model()

SEED_USERNAMES = ["cibran", "maria", "xoan", "alex"]


class Command(BaseCommand):
    help = "Populate the database with realistic demo data for testing and screenshots."

    def add_arguments(self, parser):
        parser.add_argument("--reset", action="store_true", help="Remove seed data without recreating.")

    def handle(self, *args, **options):
        if options["reset"]:
            self._delete_seed_data()
            self.stdout.write(self.style.SUCCESS("Seed data removed."))
            return

        self._delete_seed_data()

        with transaction.atomic():
            users = self._create_users()
            self._setup_contacts(users)
            stocks = self._create_stocks(users)
            routine_count, entry_count = self._create_routines(users, stocks)

        stock_count = Stock.objects.filter(user__username__in=SEED_USERNAMES).count()
        lot_count = StockLot.objects.filter(stock__user__username__in=SEED_USERNAMES).count()

        self.stdout.write(
            self.style.SUCCESS(
                f"Seed complete:\n"
                f"  {len(users)} users ({', '.join(SEED_USERNAMES)})\n"
                f"  {stock_count} stocks with {lot_count} lots\n"
                f"  {routine_count} routines with {entry_count} entries\n"
                f"  All users are mutual contacts"
            )
        )

    def _delete_seed_data(self):
        # Delete users cascades to routines, stocks, entries, etc.
        deleted, _ = User.objects.filter(username__in=SEED_USERNAMES).delete()
        if deleted:
            self.stdout.write(f"Deleted {deleted} existing seed objects.")

    def _create_users(self):
        specs = [
            {
                "username": "cibran",
                "password": "cibran123",
                "timezone": "Europe/Madrid",
                "language": "gl",
                "is_staff": True,
                "daily_notification_time": time(9, 0),
            },
            {
                "username": "maria",
                "password": "maria123",
                "timezone": "Europe/Madrid",
                "language": "es",
                "is_staff": False,
                "daily_notification_time": time(8, 0),
            },
            {
                "username": "xoan",
                "password": "xoan123",
                "timezone": "Atlantic/Canary",
                "language": "gl",
                "is_staff": False,
                "daily_notification_time": time(10, 0),
            },
            {
                "username": "alex",
                "password": "alex123",
                "timezone": "America/New_York",
                "language": "en",
                "is_staff": False,
                "daily_notification_time": time(7, 30),
            },
        ]
        users = {}
        for spec in specs:
            password = spec.pop("password")
            user = User.objects.create_user(**spec)
            user.set_password(password)
            user.save(update_fields=["password"])
            users[spec["username"]] = user
            self.stdout.write(f"  User '{spec['username']}' created.")
        return users

    def _setup_contacts(self, users):
        user_list = list(users.values())
        for i, u1 in enumerate(user_list):
            for u2 in user_list[i + 1 :]:
                u1.contacts.add(u2)
        self.stdout.write("  Contacts: all users are mutual contacts.")

    def _create_stocks(self, users):
        cibran, maria, xoan, alex = users["cibran"], users["maria"], users["xoan"], users["alex"]
        stocks = {}

        def mk(key, user, name, shared_with=None, lots=None):
            stock = Stock.objects.create(user=user, name=name)
            if shared_with:
                stock.shared_with.set(shared_with)
            for lot_spec in lots or []:
                StockLot.objects.create(stock=stock, **lot_spec)
            stocks[key] = stock

        # Cibran's stocks
        mk(
            "filtros_brita",
            cibran,
            "Filtros BRITA",
            shared_with=[maria, xoan],
            lots=[
                {"quantity": 3, "expiry_date": date(2026, 9, 15), "lot_number": "BRITA-A"},
                {"quantity": 3, "expiry_date": date(2027, 3, 15), "lot_number": "BRITA-B"},
            ],
        )
        mk(
            "lentillas",
            cibran,
            "Lentillas",
            lots=[
                {"quantity": 6, "expiry_date": date(2026, 12, 1)},
                {"quantity": 6, "expiry_date": date(2027, 6, 1)},
            ],
        )
        mk(
            "capsulas_cafe",
            cibran,
            "Cápsulas café",
            shared_with=[maria, xoan],
            lots=[
                {"quantity": 50, "lot_number": "NESPRESSO-OR"},
                {"quantity": 30, "lot_number": "NESPRESSO-VN"},
            ],
        )
        mk(
            "tinta_impresora",
            cibran,
            "Tinta impresora",
            lots=[
                {"quantity": 3, "lot_number": "HP-903XL"},
            ],
        )

        # Maria's stocks
        mk(
            "tiras_reactivas",
            maria,
            "Tiras reactivas",
            shared_with=[cibran],
            lots=[
                {"quantity": 50, "expiry_date": date(2026, 6, 15), "lot_number": "ACCU-01"},
                {"quantity": 50, "expiry_date": date(2026, 8, 15), "lot_number": "ACCU-02"},
                {"quantity": 50, "expiry_date": date(2026, 11, 15), "lot_number": "ACCU-03"},
            ],
        )
        mk(
            "vitamina_d",
            maria,
            "Vitamina D",
            lots=[
                {"quantity": 30, "expiry_date": date(2026, 10, 1), "lot_number": "SOLGAR-D3"},
                {"quantity": 30, "expiry_date": date(2027, 2, 1), "lot_number": "SOLGAR-D3"},
            ],
        )
        mk(
            "ibuprofeno",
            maria,
            "Ibuprofeno 600mg",
            shared_with=[cibran, xoan, alex],
            lots=[
                {"quantity": 20, "expiry_date": date(2027, 1, 15)},
            ],
        )
        mk(
            "bolsas_basura",
            maria,
            "Bolsas basura",
            shared_with=[cibran, xoan],
            lots=[
                {"quantity": 30},
                {"quantity": 15},
            ],
        )
        mk("apositos", maria, "Apósitos")  # 0 quantity, no lots

        # Xoan's stocks
        mk(
            "pipetas_gato",
            xoan,
            "Pipetas gato",
            shared_with=[cibran],
            lots=[
                {"quantity": 4, "expiry_date": date(2027, 4, 1), "lot_number": "FRONTLINE-L"},
            ],
        )
        mk(
            "pienso_gato",
            xoan,
            "Pienso gato",
            lots=[
                {"quantity": 5, "expiry_date": date(2026, 9, 1)},
                {"quantity": 3, "expiry_date": date(2027, 1, 1)},
            ],
        )

        # Alex's stocks
        mk(
            "protein_bars",
            alex,
            "Protein Bars",
            lots=[
                {"quantity": 12, "expiry_date": date(2026, 8, 1), "lot_number": "CLIF-PB"},
                {"quantity": 12, "expiry_date": date(2026, 12, 1), "lot_number": "CLIF-CH"},
            ],
        )
        mk(
            "whey_protein",
            alex,
            "Whey Protein",
            shared_with=[cibran],
            lots=[
                {"quantity": 45, "expiry_date": date(2026, 11, 1), "lot_number": "ON-GOLD"},
            ],
        )

        self.stdout.write(f"  {len(stocks)} stocks created with lots.")
        return stocks

    def _create_routines(self, users, stocks):
        cibran, maria, xoan, alex = users["cibran"], users["maria"], users["xoan"], users["alex"]
        now = timezone.now()
        routine_count = 0
        entry_count = 0

        def mk(user, name, interval_hours, stock=None, stock_usage=1, shared_with=None, is_active=True):
            nonlocal routine_count, entry_count
            routine = Routine.objects.create(
                user=user,
                name=name,
                interval_hours=interval_hours,
                stock=stock,
                stock_usage=stock_usage,
                is_active=is_active,
            )
            if shared_with:
                routine.shared_with.set(shared_with)
            # Create a recent entry so routines appear as "upcoming" not "never done"
            entry_time = now - timedelta(hours=interval_hours / 2)
            RoutineEntry.objects.create(routine=routine, completed_by=user, created_at=entry_time)
            routine_count += 1
            entry_count += 1

        # Cibran's routines
        mk(cibran, "Cambiar filtro BRITA", 720, stock=stocks["filtros_brita"], shared_with=[maria])
        mk(cibran, "Cambiar lentillas", 336, stock=stocks["lentillas"], stock_usage=2)
        mk(cibran, "Café mañana", 24, stock=stocks["capsulas_cafe"], stock_usage=2)
        mk(cibran, "Limpiar baño", 168, shared_with=[maria, xoan])
        mk(cibran, "Regar plantas", 72)
        mk(cibran, "Batido proteína", 48, stock=stocks["whey_protein"], stock_usage=2)

        # Maria's routines
        mk(maria, "Control glucosa", 12, stock=stocks["tiras_reactivas"], shared_with=[cibran])
        mk(maria, "Vitamina D", 24, stock=stocks["vitamina_d"])
        mk(maria, "Café tarde", 24, stock=stocks["capsulas_cafe"])
        mk(maria, "Sacar basura", 72, stock=stocks["bolsas_basura"], shared_with=[cibran, xoan])
        mk(maria, "Yoga matutino", 24)

        # Xoan's routines
        mk(xoan, "Pipeta gato", 720, stock=stocks["pipetas_gato"], shared_with=[cibran])
        mk(xoan, "Pienso gato", 336, stock=stocks["pienso_gato"])
        mk(xoan, "Café mañana", 24, stock=stocks["capsulas_cafe"])
        mk(xoan, "Limpiar arenero", 24)
        mk(xoan, "Cepillar gato", 168)

        # Alex's routines
        mk(alex, "Post-workout bar", 48, stock=stocks["protein_bars"])
        mk(alex, "Protein shake", 24, stock=stocks["whey_protein"])
        mk(alex, "Morning run", 48)
        mk(alex, "Meal prep", 168)
        mk(alex, "Gym session", 48, is_active=False)

        self.stdout.write(f"  {routine_count} routines created with {entry_count} entries.")
        return routine_count, entry_count
